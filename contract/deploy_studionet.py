"""Deploy a new SpecLock instance and verify its finalized source."""

import argparse
import base64
import hashlib
import json
from pathlib import Path

from genlayer_py import create_account, create_client
from genlayer_py.chains import studionet
from genlayer_py.types import TransactionHashVariant, TransactionStatus

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "contracts" / "spec_lock.py"
RPC = "https://studio.genlayer.com/api"
CHAIN_ID = 61999


def rpc(client, method, params):
    response = client.provider.make_request(method=method, params=params)
    if "error" in response:
        raise RuntimeError(f"{method}: {response['error']}")
    return response["result"]


def studio_client():
    if studionet.id != CHAIN_ID or studionet.rpc_urls["default"]["http"][0] != RPC:
        raise RuntimeError("SDK configuration does not target Studionet")
    client = create_client(chain=studionet, account=create_account())
    if client.w3.eth.chain_id != CHAIN_ID:
        raise RuntimeError("Unexpected RPC chain ID")
    return client


def verify_deployment(client, receipt, deploy_tx):
    if receipt["status_name"] != "FINALIZED" or receipt["result_name"] != "MAJORITY_AGREE":
        raise RuntimeError("Deployment did not finalize with majority agreement")
    leaders = receipt["consensus_data"]["leader_receipt"]
    leader = leaders[-1] if isinstance(leaders, list) else leaders
    if leader["execution_result"] != "SUCCESS":
        raise RuntimeError("Deployment constructor did not execute successfully")

    address = receipt["data"]["contract_address"]
    deployed = base64.b64decode(rpc(client, "gen_getContractCode", [address]), validate=True)
    source = SOURCE.read_bytes()
    if deployed != source:
        raise RuntimeError("Deployed source differs from contracts/spec_lock.py")
    counts = client.read_contract(
        address=address,
        function_name="get_counts",
        args=[],
        transaction_hash_variant=TransactionHashVariant.LATEST_FINAL,
    )
    if set(counts) != {"specs", "challenges"} or any(
        type(count) is not int or count < 0 for count in counts.values()
    ):
        raise RuntimeError(f"Unexpected get_counts result: {counts!r}")
    return {
        "network": "Studionet",
        "chain_id": CHAIN_ID,
        "rpc": RPC,
        "contract_address": address,
        "deploy_tx": deploy_tx,
        "deploy_status": "FINALIZED",
        "execution_result": "SUCCESS",
        "source_matches_deployed_code": True,
        "source_sha256": hashlib.sha256(source).hexdigest(),
        "finalized_get_counts": counts,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--resume", metavar="TX",
        help="Verify an existing deployment transaction rather than submitting another",
    )
    args = parser.parse_args()
    client = studio_client()
    tx = args.resume
    if tx is None:
        address = client.local_account.address
        rpc(client, "sim_fundAccount", [address, 10**20])
        if client.w3.eth.get_balance(address) == 0:
            raise RuntimeError("Studionet test wallet has no balance after faucet")
        tx = client.deploy_contract(code=SOURCE.read_text(encoding="utf-8"), leader_only=False)
        print(f"Submitted Studionet deployment {tx}", flush=True)
    receipt = client.wait_for_transaction_receipt(
        transaction_hash=tx, status=TransactionStatus.FINALIZED, retries=90, full_transaction=True,
    )
    report = verify_deployment(client, receipt, tx)
    payload = json.dumps(report, indent=2) + "\n"
    (ROOT / "deployment_info.json").write_text(payload, encoding="utf-8")
    print(payload, end="")


if __name__ == "__main__":
    main()
