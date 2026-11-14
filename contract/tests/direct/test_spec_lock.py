import json
from unittest.mock import patch

import pytest

from prepare_challenge import commitment_digest

PUBLISHER = "0x" + "11" * 20
COUNTERPARTY = "0x" + "22" * 20
CHALLENGER = "0x" + "33" * 20
OTHER = "0x" + "44" * 20
SALT = "ef" * 32
CLAUSES = {"cadence": "Publish two posts per week."}
CLEAR = {"cadence": "Publish two posts each Monday to Sunday, UTC. Rolling periods do not count."}
EVIDENCE = {
    "clause_id": "cadence",
    "scenario": (
        "Exactly four posts exist: Monday and Tuesday 2 and 3 November 2026 at noon UTC, "
        "then Saturday and Sunday 14 and 15 November 2026 at noon UTC. Evaluate the two "
        "calendar weeks 2–8 and 9–15 November and every rolling seven-day window entirely "
        "inside 2–15 November."
    ),
    "reading_a": "A week means a Monday to Sunday calendar week in UTC.",
    "outcome_a": "Pass: both calendar weeks have two posts.",
    "reading_b": "Every rolling seven-day period must have two posts.",
    "outcome_b": "Fail: the seven-day window 5–11 November has zero posts.",
}


def register(contract, clauses=CLAUSES):
    return contract.register_spec(COUNTERPARTY, json.dumps(clauses), 60, 60, 7)


def commit(vm, contract, revision, challenger=CHALLENGER, salt=SALT, evidence=EVIDENCE):
    from genlayer import gl

    digest = commitment_digest(str(gl.message.contract_address), revision, challenger, evidence, salt)
    with vm.prank(challenger):
        return contract.commit_challenge(revision, digest)


def reveal(vm, contract, challenge, challenger=CHALLENGER, salt=SALT, evidence=EVIDENCE):
    with vm.prank(challenger):
        contract.reveal_challenge(challenge, json.dumps(evidence), salt)


def evaluate(contract, challenge, decision):
    from genlayer.gl import nondet

    with patch.object(nondet, "exec_prompt", return_value={"decision": decision}):
        return contract.evaluate_challenge(challenge)


def begin_reveal(vm):
    vm.warp("2026-11-14T00:01:00+00:00")


def end_reveal(vm):
    vm.warp("2026-11-14T00:02:00+00:00")


def test_commit_bound_to_sender_payload_and_window(spec_lock):
    vm, contract = spec_lock
    revision = register(contract)
    challenge = commit(vm, contract, revision)
    with vm.expect_revert("Duplicate commitment"):
        commit(vm, contract, revision)
    with vm.expect_revert("Outside reveal window"):
        reveal(vm, contract, challenge)
    begin_reveal(vm)
    with vm.expect_revert("Commit window is closed"):
        commit(vm, contract, revision, OTHER)
    with vm.expect_revert("original challenger"):
        reveal(vm, contract, challenge, OTHER)
    with vm.expect_revert("Commitment does not match"):
        reveal(vm, contract, challenge, salt="00" * 32)
    with vm.expect_revert("Commitment does not match"):
        reveal(vm, contract, challenge, evidence={**EVIDENCE, "outcome_b": "Different result"})
    reveal(vm, contract, challenge)
    assert contract.get_challenge(challenge)["status"] == "PENDING"
    assert contract.get_revision(revision)["pending"] == 1


def test_contract_parties_cannot_challenge_their_spec(spec_lock):
    vm, contract = spec_lock
    revision = register(contract)
    with vm.expect_revert("Only third parties"):
        commit(vm, contract, revision, PUBLISHER)


def test_confirmed_ambiguity_blocks_and_awards_once_per_clause(spec_lock):
    vm, contract = spec_lock
    revision = register(contract)
    a = commit(vm, contract, revision)
    b = commit(vm, contract, revision, OTHER)
    with vm.prank(COUNTERPARTY):
        contract.accept_revision(revision)
    begin_reveal(vm)
    reveal(vm, contract, a)
    reveal(vm, contract, b, OTHER)
    for challenge in (a, b):
        assert evaluate(contract, challenge, "AMBIGUITY_CONFIRMED") == "AMBIGUITY_CONFIRMED"
    assert contract.get_credits(CHALLENGER) == 7
    assert contract.get_credits(OTHER) == 0
    end_reveal(vm)
    with vm.expect_revert("challenges block activation"):
        contract.activate_spec(revision)
    with vm.expect_revert("not awaiting review"):
        contract.evaluate_challenge(a)


def test_inconclusive_blocks_until_review_resolves(spec_lock):
    vm, contract = spec_lock
    revision = register(contract)
    challenge = commit(vm, contract, revision)
    with vm.prank(COUNTERPARTY):
        contract.accept_revision(revision)
    begin_reveal(vm)
    reveal(vm, contract, challenge)
    assert evaluate(contract, challenge, "INCONCLUSIVE") == "INCONCLUSIVE"
    end_reveal(vm)
    with vm.expect_revert("challenges block activation"):
        contract.activate_spec(revision)
    assert evaluate(contract, challenge, "NOT_DEMONSTRATED") == "NOT_DEMONSTRATED"
    contract.activate_spec(revision)
    assert contract.get_revision(revision)["active"]
    assert contract.get_credits(CHALLENGER) == 0


def test_revision_preserves_old_evidence_and_requires_fresh_acceptance(spec_lock):
    vm, contract = spec_lock
    first = register(contract)
    challenge = commit(vm, contract, first)
    with vm.prank(COUNTERPARTY):
        contract.accept_revision(first)
    begin_reveal(vm)
    second = contract.publish_revision("1", json.dumps(CLEAR))
    reveal(vm, contract, challenge)
    assert evaluate(contract, challenge, "AMBIGUITY_CONFIRMED") == "AMBIGUITY_CONFIRMED"
    assert contract.get_revision(first)["superseded"]
    assert contract.get_revision(first)["clauses"] == CLAUSES
    assert contract.get_revision(second)["clauses"] == CLEAR
    vm.warp("2026-11-14T00:03:00+00:00")
    with vm.expect_revert("superseded"):
        contract.activate_spec(first)
    with vm.expect_revert("Acceptance and completed review"):
        contract.activate_spec(second)
    with vm.prank(COUNTERPARTY):
        contract.accept_revision(second)
    contract.activate_spec(second)
    assert contract.get_credits(CHALLENGER) == 7


def test_unrevealed_commit_expires_without_blocking(spec_lock):
    vm, contract = spec_lock
    revision = register(contract)
    challenge = commit(vm, contract, revision)
    with vm.prank(COUNTERPARTY):
        contract.accept_revision(revision)
    begin_reveal(vm)
    with vm.expect_revert("completed review window"):
        contract.activate_spec(revision)
    end_reveal(vm)
    with vm.expect_revert("Outside reveal window"):
        reveal(vm, contract, challenge)
    contract.activate_spec(revision)
    assert contract.get_revision(revision)["active"]


@pytest.mark.parametrize("payload", [{"decision": "YES"}, {"decision": "NOT_DEMONSTRATED", "extra": True}])
def test_malformed_model_output_leaves_challenge_pending(spec_lock, payload):
    from genlayer.gl import nondet

    vm, contract = spec_lock
    revision = register(contract)
    challenge = commit(vm, contract, revision)
    begin_reveal(vm)
    reveal(vm, contract, challenge)
    with patch.object(nondet, "exec_prompt", return_value=payload), vm.expect_revert("Invalid evaluation"):
        contract.evaluate_challenge(challenge)
    assert contract.get_challenge(challenge)["status"] == "PENDING"
    assert contract.get_revision(revision)["pending"] == 1


def test_validator_requires_independent_agreement(spec_lock):
    from genlayer.gl import nondet

    vm, contract = spec_lock
    revision = register(contract)
    challenge = commit(vm, contract, revision)
    begin_reveal(vm)
    reveal(vm, contract, challenge)
    evaluate(contract, challenge, "AMBIGUITY_CONFIRMED")
    with patch.object(nondet, "exec_prompt", return_value={"decision": "AMBIGUITY_CONFIRMED"}) as model:
        assert vm.run_validator()
        assert model.call_count == 1
    with patch.object(nondet, "exec_prompt", return_value={"decision": "NOT_DEMONSTRATED"}):
        assert not vm.run_validator()
