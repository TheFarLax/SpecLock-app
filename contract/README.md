# SpecLock

SpecLock is a GenLayer Intelligent Contract for challenging ambiguous terms before they become active. A challenge presents two plausible readings of the same terms, a single scenario, and the different outcomes each reading produces.

For example, “publish two posts per week” may mean two posts in each calendar week or two in every rolling seven-day period. The same posting schedule can satisfy one rule and fail the other.

## Workflow

1. The publisher calls `register_spec(counterparty, clauses_json, commit_seconds, reveal_seconds, credits_per_clause)`. The call returns a revision ID such as `1:1`. Each window runs for 60 to 604800 seconds.
2. The named counterparty calls `accept_revision(revision_id)`. The publisher accepts the version by publishing it.
3. Before `commit_until`, a third party calls `commit_challenge(revision_id, digest)` and keeps the returned challenge ID.
4. From `commit_until` through the moment before `reveal_until`, that same wallet calls `reveal_challenge(challenge_id, evidence_json, salt)`.
5. Any caller can send `evaluate_challenge(challenge_id)`. Validators independently classify the same frozen evidence and compare their verdicts.
6. Either party can call `activate_spec(revision_id)` once the review window has closed, the counterparty has accepted, and all revealed challenges are resolved without any confirmed ambiguity.

| Verdict | Effect |
|---|---|
| `AMBIGUITY_CONFIRMED` | Blocks activation of that version. The first confirmation recorded for each clause and revision awards the configured credits. |
| `NOT_DEMONSTRATED` | Resolves the challenge without a blocker or reward. |
| `INCONCLUSIVE` | Leaves the challenge unresolved. Anyone can request another evaluation. |

Unrevealed commitments expire at the reveal deadline. The publisher can call `publish_revision(spec_id, clauses_json)` to open a new review window. The counterparty must accept the new version. Old revisions, submitted challenges and earned credits remain available for inspection. Older commitments can still be revealed during their original reveal window.

Credits are contract accounting records with no redemption or token transfer. A revision marked active has cleared the submitted challenges under these rules.

## Preparing a challenge

Create a JSON object with six string fields. Use the same facts in both readings.

```json
{
  "clause_id": "cadence",
  "scenario": "Four posts were published on 2, 3, 14 and 15 November 2026 UTC.",
  "reading_a": "A week means a Monday to Sunday calendar week.",
  "outcome_a": "Pass: 2–8 and 9–15 November each contain two posts.",
  "reading_b": "A week means any rolling seven-day period.",
  "outcome_b": "Fail: 5–11 November contains zero posts."
}
```

```sh
python prepare_challenge.py CONTRACT_ADDRESS 1:1 CHALLENGER_ADDRESS evidence.json
```

The command prints the commitment digest and saves the evidence plus a random salt in `reveal.json`. Keep that file private until the reveal window. The digest binds the evidence to the contract, revision and challenger address.

## Studionet

- Chain ID `61999`
- [SpecLock Explorer](https://explorer-studio.genlayer.com/address/0xd8aD83d48Ae91F5B33321775D1D1aF6f5A97FEb1)
- Deployment transaction `0xfe4bc497fce53308685af28c8298a045f0cb315692b14ef8bbc948ff6172fc9a`
- Deployment finalized successfully. The packaged contract was verified against on-chain source bytes.

## Setup and verification

Use Python 3.12 or later.

```sh
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
genvm-lint check contracts/spec_lock.py
python -m pytest tests/direct/ -q
python test_deployed.py
```

The nine direct tests cover authorization, commitment binding, timing, duplicate reward prevention, revisions and independent validator agreement with mocked model responses. Running `python test_deployed.py --live` creates public fixtures on Studionet and waits for the commit and reveal windows. Use `python deploy_studionet.py` to deploy a separate instance.

[The recorded Studionet run](test_report.json) finalized five successful writes. Challenge `1` on revision `1:1` returned `AMBIGUITY_CONFIRMED`. Finalized state showed one blocker, an inactive revision and seven credits awarded to the challenger. The activation rejection was exercised in the local tests.
