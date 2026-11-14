"""Verify a Studionet deployment and optionally run the public review workflow."""

import argparse
import json
import secrets
import time

from genlayer_py import create_account
from genlayer_py.abi import calldata
from genlayer_py.types import TransactionHashVariant, TransactionStatus
from eth_utils import to_checksum_address

from deploy_studionet import ROOT, rpc, studio_client, verify_deployment
from prepare_challenge import commitment_digest

EVIDENCE = {
    "clause_id": "cadence",
    "scenario": (
        "Four posts were published in UTC, on November 2, 3, 14 and 15, 2026. "
        "Assess compliance for the two full calendar weeks November 2–8 and 9–15 "
        "and for all seven-day periods wholly inside November 2–15."
    ),
    "reading_a": "A week means a fixed Monday–Sunday calendar week.",
    "outcome_a": "The schedule complies: both weeks contain exactly two posts.",
    "reading_b": "A week means any rolling seven-day window.",
    "outcome_b": "The schedule fails: November 5–11 contains no posts.",
}


def read(client, address, method, *args):
    return client.read_contract(
        address=address, function_name=method, args=list(args),
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL,
    )


def execution_result(receipt, entry, expect_error=None):
    leaders = receipt["consensus_data"]["leader_receipt"]
    if not isinstance(leaders, list):
        leaders = [leaders]
    completed = [
        candidate for candidate in leaders
        if (candidate.get("genvm_result") or {}).get("error_code") != "CONSENSUS_VALIDATOR_QUORUM_REACHED"
    ]
    entry["quorum_cancellations"] = len(leaders) - len(completed)
    if not completed:
        raise RuntimeError(f"No completed execution receipt for {entry['tx_hash']}")
    leader = completed[-1]
    result = leader["result"]
    entry.update(
        status=receipt["status_name"], consensus=receipt["result_name"],
        execution_result=leader["execution_result"], return_status=result["status"],
    )
    method = entry["method"]
    if entry["status"] != "FINALIZED" or entry["consensus"] != "MAJORITY_AGREE":
        raise RuntimeError(f"{method} did not finalize with agreement: {entry}")
    if expect_error is not None:
        return_status = result["status"]
        detail = str(result.get("payload"))
        if return_status not in ("contract_error", "rollback") or expect_error not in detail:
            raise RuntimeError(f"Unexpected rejection response: {entry}, {detail}")
        entry["expected_rejection"] = detail
        return None
    if entry["execution_result"] != "SUCCESS" or result["status"] != "return":
        detail = result.get("payload")
        entry["error"] = str(detail)
        raise RuntimeError(f"{method} failed: {entry}, {detail}")
    return calldata.decode(bytes(result["payload"]["raw"]))


def write(client, address, report, account, method, *args, expect_error=None):
    tx = client.write_contract(
        address=address, function_name=method, args=list(args), account=account,
        leader_only=False,
    )
    entry = {"method": method, "tx_hash": tx}
    report["transactions"].append(entry)
    print(f"Submitted {method} {tx}", flush=True)
    receipt = client.wait_for_transaction_receipt(
        transaction_hash=tx, status=TransactionStatus.FINALIZED,
        interval=3500, retries=100, full_transaction=True,
    )
    result = execution_result(receipt, entry, expect_error)
    print(f"Finalized {method} ({entry['return_status']})", flush=True)
    return result


def wait_until(timestamp):
    while (remaining := timestamp - time.time()) > 0:
        time.sleep(min(remaining, 10))


def require(condition, error):
    if not condition:
        raise RuntimeError(error)


def run_live(client, address, report):
    publisher, counterparty, challenger = client.local_account, create_account(), create_account()
    for account in (publisher, counterparty, challenger):
        rpc(client, "sim_fundAccount", [account.address, 10**20])
    clauses = json.dumps({"cadence": "Publish two posts per week."})
    revision_id = write(
        client, address, report, publisher, "register_spec",
        counterparty.address, clauses, 150, 150, 7,
    )
    report["revision_id"] = revision_id
    revision = read(client, address, "get_revision", revision_id)
    salt = secrets.token_hex(32)
    digest = commitment_digest(address, revision_id, challenger.address, EVIDENCE, salt)
    challenge_id = write(client, address, report, challenger, "commit_challenge", revision_id, digest)
    report["challenge_id"] = challenge_id
    write(client, address, report, counterparty, "accept_revision", revision_id)
    printed_time = time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(revision["commit_until"]))
    print(f"Reveal opens {printed_time}", flush=True)
    wait_until(revision["commit_until"] + 2)
    write(
        client, address, report, challenger, "reveal_challenge",
        challenge_id, json.dumps(EVIDENCE), salt,
    )
    verify_challenge(client, address, report)
    wait_until(revision["reveal_until"] + 2)
    write(
        client, address, report, publisher, "activate_spec", revision_id,
        expect_error="Pending or confirmed challenges block activation",
    )
    require(not read(client, address, "get_revision", revision_id)["active"],
            "Blocked revision became active")
    report["activation_rejection"] = "VERIFIED"


def verify_challenge(client, address, report):
    revision_id, challenge_id = report["revision_id"], report["challenge_id"]
    challenge = read(client, address, "get_challenge", challenge_id)
    if challenge["status"] in ("PENDING", "INCONCLUSIVE"):
        decision = write(client, address, report, client.local_account, "evaluate_challenge", challenge_id)
        challenge = read(client, address, "get_challenge", challenge_id)
    else:
        entry = next(
            tx for tx in reversed(report["transactions"]) if tx["method"] == "evaluate_challenge"
        )
        decision = execution_result(client.get_transaction(entry["tx_hash"]), entry)
    blocked = read(client, address, "get_revision", revision_id)
    balance = read(client, address, "get_credits", to_checksum_address(challenge["challenger"]))
    report.update(
        decision=decision, confirmed_challenge=challenge,
        blocked_revision=blocked, challenger_credits=balance,
    )
    require(decision == challenge["status"] == "AMBIGUITY_CONFIRMED", "Unexpected ambiguity verdict")
    require(challenge["evidence"] == EVIDENCE, "Stored evidence differs from reveal")
    require(blocked["accepted"] and blocked["pending"] == 0 and blocked["blockers"] == 1
            and not blocked["active"],
            "Confirmed challenge did not block revision")
    require(balance == challenge["credits_awarded"] == 7, "Incorrect challenger credits")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--deployment-tx", help="Existing SpecLock deploy transaction")
    parser.add_argument("--live", action="store_true", help="Write public test records on Studionet")
    parser.add_argument("--resume-challenge", action="store_true", help="Retry a previously revealed test")
    args = parser.parse_args()
    metadata_path = ROOT / "deployment_info.json"
    public_report = ROOT / "test_report.json"
    tx = args.deployment_tx
    if tx is None:
        tx = json.loads(
            (metadata_path if metadata_path.exists() else public_report).read_text(encoding="utf-8")
        )["deploy_tx"]
    client = studio_client()
    report = verify_deployment(client, client.get_transaction(tx), tx)
    if args.live and args.resume_challenge:
        parser.error("Choose --live or --resume-challenge")
    if args.live or args.resume_challenge:
        if args.resume_challenge:
            prior = json.loads(public_report.read_text(encoding="utf-8"))
            require(prior["contract_address"].lower() == report["contract_address"].lower(),
                    "Previous test used a different contract")
            report["live_ai"] = prior["live_ai"]
            report["live_ai"].pop("error", None)
            existing = read(client, report["contract_address"], "get_challenge", report["live_ai"]["challenge_id"])
            if existing["status"] in ("PENDING", "INCONCLUSIVE"):
                rpc(client, "sim_fundAccount", [client.local_account.address, 10**20])
        else:
            report["live_ai"] = {"status": "IN_PROGRESS", "transactions": []}
        try:
            if args.resume_challenge:
                verify_challenge(client, report["contract_address"], report["live_ai"])
                report["live_ai"]["activation_rejection"] = "LOCAL_TEST_ONLY"
            else:
                run_live(client, report["contract_address"], report["live_ai"])
        except Exception as error:
            report["live_ai"].update(status="FAILED", error=str(error))
            public_report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            raise
        report["live_ai"]["status"] = "PASSED"
        public_report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
