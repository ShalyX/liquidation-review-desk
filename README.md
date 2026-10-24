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
- Browser sources: [Blockscout transaction](https://eth.blockscout.com/tx/0xb8d6664c5317bad149d2d3cd46794082580a5a2ae9b0cff74b7c9ab039b0c008) and PublicNode's Ethereum JSON-RPC receipt.
- Contract sources: Blockscout transaction/log data and Routescan's Ethereum mainnet `eth_getTransactionReceipt` endpoint. The contract independently checks the successful block and exact selected Aave V3 event before asking validators to assess context.
- The sample contains two matching Aave V3 liquidation events at log indices 2295 and 2306. The browser rejects a receipt with a different chain ID, block, status, event count, or event data.

The sample demonstrates event selection and decoding only. It is not an example of a fair/unfair outcome or a validated market-price claim.

## Run locally

Requirements: Node.js 20.19+ or 22.12+, Python 3.10+, and a supported GenLayer test environment for direct contract tests.

```powershell
npm install
npm run dev
```

Create `.env.local` from `.env.example` and set `VITE_CONTRACT_ADDRESS` after deploying `contracts/liquidation_review.py` to StudioNet. The application reads this build-time configuration; users do not enter deployment addresses in the product.

```powershell
npm run build
python -m pip install -r tests/requirements.txt
python -m pytest -p no:cacheprovider tests/direct -q
```

## Contract

`contracts/liquidation_review.py` re-fetches the transaction and logs from Blockscout, then independently fetches `eth_getTransactionReceipt` from Routescan's Ethereum mainnet API. It compares the successful transaction status, block number, exact Aave V3 pool, event signature, selected log index, and every decoded event field before asking validators to review context. Validator fingerprints use normalized transaction and event facts, so confirmation-count drift and provider JSON formatting do not create false disagreements.

Consensus compares the outcome, basis, confidence, and digests of the transaction, indexed logs, RPC receipt, and contextual evidence. Source errors become `source_failure`; inadequate context remains `unclear`. Web content is untrusted, and embedded instructions are explicitly ignored.

## Current status

- Live source verification: the browser checks Blockscout data against PublicNode; the contract checks Blockscout data against Routescan. Both paths confirm Ethereum mainnet receipt status, block, and the selected Aave V3 liquidation event.
- The production site is live at https://liquidation-review-desk.vercel.app/. The active StudioNet contract is `0xD2A8BA96d543e28b00aa87c4843FC9Cbce51609a`, deployed in finalized transaction [`0x7b1db74e90e6437d4dbcb943e4845da8d71e72fe456ce4da181ca11a7b2e74d4`](https://explorer-studio.genlayer.com/tx/0x7b1db74e90e6437d4dbcb943e4845da8d71e72fe456ce4d4). It retains the 200,000-byte bounded Blockscout response limit and now rejects internally inconsistent verdict/basis/rationale combinations by recording an `unclear` result.
- Historical assessment links remain readable from the previous deployments; new reviews use the active contract.
- Live StudioNet assessment: transaction `0xf71d50627cd21fbcf4a9d242c8ea2b9a54267588bef3a363551a3da4059aa984` finalized with `MAJORITY_AGREE`. Readback of `liq-stable-20261024` confirmed the exact sample transaction and selected log index `2295`, with outcome `no_concern_identified` for the narrow claim that at least 1 USDC of debt was repaid. This is not a fairness finding.
- Live real-case regression on the active contract: transaction [`0xe4aef8ea6b5e3cfb0ed989aade63a566488b9fc3e046a447363b15a907f1e47b`](https://explorer-studio.genlayer.com/tx/0xe4aef8ea6b5e3cfb0ed989aade63a566488b9fc3e046a447363b15a907f1e47b) finalized with `MAJORITY_AGREE`. Direct `get_assessment` readback of `liq-mvmy25-consistency` stored `no_concern_identified / contradicting_context / high`; the cited prices give a collateral-to-debt ratio of about 1.0559, below the claim's 1.10 threshold. This validated the contract directly through the CLI; the browser-wallet submission path still needs its own end-to-end rerun.
- Local GenLayer direct tests: 26 passed. Frontend source tests: 5 passed. The production frontend build succeeds. These checks do not substitute for live consensus evidence.
- Historical Aave oracle prices and reserve configuration are not yet reconstructed at the transaction block. Until then, this tool must not state that a liquidation price was fair or unfair.

## Data and privacy

GenLayer transaction arguments and stored assessments are public and permanent. Do not enter borrower identities, private correspondence, personal data, or confidential claims. Only use public context pages. The review is a research triage record, not financial or legal advice.
