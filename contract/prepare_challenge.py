"""Compute a SpecLock commitment and save the private reveal payload."""

import argparse
import hashlib
import json
import os
import secrets
from pathlib import Path

FIELDS = {"clause_id", "scenario", "reading_a", "outcome_a", "reading_b", "outcome_b"}


def commitment_digest(address, revision_id, challenger, evidence, salt):
    if set(evidence) != FIELDS or any(not isinstance(value, str) for value in evidence.values()):
        raise ValueError("Evidence requires exactly six string fields")
    payload = json.dumps(
        [
            "SpecLock/v1", address.lower(), revision_id, challenger.lower(),
            {key: value.strip() for key, value in evidence.items()}, salt,
        ],
        sort_keys=True, separators=(",", ":"), ensure_ascii=True,
    )
    return hashlib.sha256(payload.encode("ascii")).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("contract")
    parser.add_argument("revision_id")
    parser.add_argument("challenger")
    parser.add_argument("evidence", type=Path, help="JSON object with the six challenge fields")
    parser.add_argument("--out", type=Path, default=Path("reveal.json"))
    args = parser.parse_args()
    evidence = json.loads(args.evidence.read_text(encoding="utf-8"))
    salt = secrets.token_hex(32)
    digest = commitment_digest(args.contract, args.revision_id, args.challenger, evidence, salt)
    with os.fdopen(os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as f:
        json.dump({"evidence": evidence, "salt": salt}, f, indent=2)
    print(digest)


if __name__ == "__main__":
    main()
