# Liquidation Review Desk

A public research desk for a second look at an already-mined Aave V3 liquidation on Ethereum. The app verifies the selected `LiquidationCall` event, asks GenLayer validators to assess a narrow concern against cited public context, and reads the finalized assessment back from the contract.

This project does not reverse liquidations, recover funds, decide legal liability, or declare that an event was fair or unfair. A source-chain event proves what the contract emitted. It does not by itself establish whether the execution was fair.

## Product workflow

1. Paste a successful Ethereum transaction hash.
2. The app finds every canonical Aave V3 liquidation event in that transaction. Select one event; batched liquidations stay separate.
3. The browser checks Blockscout data against an independent Ethereum receipt.
4. State a specific review concern and optionally cite public market, protocol, or governance context.
5. Connect a wallet on GenLayer StudioNet and submit the assessment.
6. Wait for the protocol transaction to finalize, check execution success, and read the case back from contract storage.

## Verified sample

The UI has a clearly labeled real Ethereum sample transaction:

- Transaction: `0xb8d6664c5317bad149d2d3cd46794082580a5a2ae9b0cff74b7c9ab039b0c008`
- Block: `26196204`
- Mined: `2026-10-15T06:45:11Z`
- Aave V3 `LiquidationCall` logs: `2295` and `2306`
- Sources: [Blockscout transaction](https://eth.blockscout.com/tx/0xb8d6664c5317bad149d2d3cd46794082580a5a2ae9b0cff74b7c9ab039b0c008) and Routescan's Ethereum mainnet `eth_getTransactionReceipt` endpoint.
- Independent source comparison: both endpoints returned the same successful mainnet block and exactly two matching Aave V3 liquidation events, at log indices 2295 and 2306. The UI rejects a receipt with a different chain ID, block, status, event count, or event data.

The sample demonstrates event selection and decoding only. It is not an example of a fair/unfair outcome or a validated market-price claim.

## Run locally

Requirements: Node.js 20.19+ or 22.12+, Python 3.10+, and a supported GenLayer test environment for direct contract tests.

```powershell
npm install
npm run dev
```

Create `.env.local` from `.env.example` and set `VITE_CONTRACT_ADDRESS` after deploying `contracts/liquidation_review.py` to StudioNet. The local-storage Operator setup field can override the public address during development.

```powershell
npm run build
python -m pip install -r tests/requirements.txt
python -m pytest -p no:cacheprovider tests/direct -q
```

## Contract

`contracts/liquidation_review.py` re-fetches the transaction and logs from Blockscout, then independently fetches `eth_getTransactionReceipt` from Routescan's Ethereum mainnet API. It compares the successful transaction status, block number, exact Aave V3 pool, event signature, selected log index, and every decoded event field before asking validators to review context. Validator fingerprints use normalized transaction and event facts, so confirmation-count drift and provider JSON formatting do not create false disagreements.

Consensus compares the outcome, basis, confidence, and digests of the transaction, indexed logs, RPC receipt, and contextual evidence. Source errors become `source_failure`; inadequate context remains `unclear`. Web content is untrusted, and embedded instructions are explicitly ignored.

## Current status

- Live source verification: Blockscout and Routescan independently confirmed the sample transaction, Ethereum mainnet receipt status, block, and selected Aave V3 liquidation event.
- The production site is live at https://liquidation-review-desk.vercel.app/. Its production build is configured with StudioNet contract `0x0Eb39598774744dFf564E1781c10b6eEe85aB853`.
- Live StudioNet assessment: transaction `0xf71d50627cd21fbcf4a9d242c8ea2b9a54267588bef3a363551a3da4059aa984` finalized with `MAJORITY_AGREE`. Readback of `liq-stable-20261024` confirmed the exact sample transaction and selected log index `2295`, with outcome `no_concern_identified` for the narrow claim that at least 1 USDC of debt was repaid. This is not a fairness finding.
- Local GenLayer direct tests: 24 passed. Frontend source tests: 5 passed. The production frontend build succeeds. These checks do not substitute for live consensus evidence.
- Historical Aave oracle prices and reserve configuration are not yet reconstructed at the transaction block. Until then, this tool must not state that a liquidation price was fair or unfair.

## Data and privacy

GenLayer transaction arguments and stored assessments are public and permanent. Do not enter borrower identities, private correspondence, personal data, or confidential claims. Only use public context pages. The review is a research triage record, not financial or legal advice.
