# SpecLock

SpecLock is a Studionet dApp for finding ambiguous terms before they become active. It connects a browser workspace to the deployed GenLayer Intelligent Contract at `0xd8aD83d48Ae91F5B33321775D1D1aF6f5A97FEb1`. [Contract explorer](https://explorer-studio.genlayer.com/address/0xd8aD83d48Ae91F5B33321775D1D1aF6f5A97FEb1)

- Browse finalized revisions, challenges and verdicts without connecting a wallet.
- Publish terms and revisions, accept as the named counterparty, and activate eligible versions.
- Prepare a challenge commitment and download its reveal backup. Import it on another device to reveal from the original wallet.
- Submit revealed challenges for evaluation and follow transactions in Activity. Activity is stored in the current browser.

A publisher and a counterparty can review and accept terms. A separate wallet can challenge them during the review period. Credits are contract records. Use test data on Studionet, since terms and revealed evidence become public.

## Compare revision wording

Open a revision in the workspace and select **Compare wording**. Edit a draft against the loaded revision, or select **Published revision** and enter two finalized revision IDs from the same specification. The comparison shows added, edited and removed clauses side by side and counts the unchanged clauses. A renamed clause ID appears as a removal and an addition.

For a wallet-free walkthrough, load revision **1:1**, select **Try cadence example**, then **Compare changes**. The draft replaces “Publish two posts per week” with a Monday-through-Sunday cadence measured in UTC. Open challenge **1** to see why the original wording led to two outcomes. To publish a rewrite, enter the reviewed wording in the existing publication form.

## Run locally

Use Node.js 22 or later and an EIP-1193 wallet for signed actions.

```sh
npm ci
npm test
npm run build
python3 -m http.server 4173 --directory dist
```

Open `http://localhost:4173`. The static build lives in `dist/`. For another host, serve the contents of `dist/` over HTTPS so the browser can compute commitment hashes and connect a wallet.

## Project files

| Path | Contents |
|---|---|
| `src/` | Browser UI, Studionet client, commitment and receipt handling |
| `tests/` | Frontend protocol checks |
| `contract/` | Verified Python contract, deployment and test scripts, test report |
| `build.mjs` | Static build |
| `dist/` | Ready-to-serve production build |

## Verification

The app loaded finalized revision `1:1` and challenge `1` from Studionet in a browser. A temporary test signer using the frontend's provider path published revision `2:1`, then read it from finalized state in transaction `0x0675382a5327497677d62f2989080ed6f62d94733ec55a8c4288c5ff43514c00`. The browser wallet extension itself was not used for that test.

See [contract/README.md](contract/README.md) and [contract/test_report.json](contract/test_report.json) for the contract's direct tests, live AI evaluation and deployment receipts.
