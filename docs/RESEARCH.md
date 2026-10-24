# Research Notes

Research checked 2026-10-24. This is a project-scoping note, not proof that no competing product exists.

## GenLayer fit

GenLayer's official use-case page specifically asks whether a DeFi liquidation price was acceptable given market conditions. Official docs describe the protocol fit as a shared outcome where evidence or judgment cannot be reduced to ordinary deterministic code. The product therefore restricts deterministic code to chain facts and uses consensus only for the contextual review.

## Aave data and mechanics

- Aave's official FAQ says a position becomes eligible when health factor is below 1 and describes debt repayment, collateral seizure, close-factor behavior, and liquidation bonuses.
- Aave's official documentation says historical protocol data can be queried from events or indexed sources such as its subgraphs; historical subgraph queries can specify a block.
- Ethereum mainnet Aave V3 Pool: `0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2`.
- `LiquidationCall` event signature topic: `0xe413a321e8681d831f4dbccbca790d2952b56f977908e45be37335533e005286`.
- Data spike: Blockscout transaction `0xb8d6664c5317bad149d2d3cd46794082580a5a2ae9b0cff74b7c9ab039b0c008`, block `26196204`, timestamp `2026-10-15T06:45:11Z`, returned successful status and two separate Aave V3 `LiquidationCall` logs at indices 2295 and 2306.
- Independent check: PublicNode `eth_getTransactionReceipt` returned the same successful transaction and block, with the same two canonical Aave events at log indices 2295 and 2306; decoded event data matched Blockscout. The app requires mainnet chain ID, receipt success, exact block, and exact complete event-set equality before allowing submission.

## Existing products and distinction

The current curated GenLayer ecosystem directory lists prediction markets, an oracle, agent marketplaces, justice, uptime, and governance-oriented projects; it did not list a post-liquidation review product when checked. This directory is curated and is not an exhaustive competitor census.

Existing DeFi tools include liquidation analytics dashboards and automated liquidation-protection products. The proposed product's distinct job is after-the-fact, evidence-cited review of a specific lending-protocol liquidation, with an onchain consensus record. SwapIntent reviews a proposed route before execution; Rulewake is described in the project inventory as collateral-change risk monitoring before liquidation.

## Sources

- GenLayer use cases: https://genlayer.com/use-cases
- GenLayer builder fit: https://docs.genlayer.com/developers/intelligent-contracts/when-to-use-genlayer
- GenLayer web access: https://docs.genlayer.com/developers/intelligent-contracts/features/web-access
- Aave liquidation FAQ: https://aave.com/faq
- Aave historical data guidance: https://aave.com/faq
- Aave subgraph repository: https://github.com/aave/protocol-subgraphs
- Aave V3 Pool docs: https://www.aave.com/docs/aave-v3/smart-contracts/pool
- Curated GenLayer projects: https://portal.genlayer.foundation/ecosystem-partners/
- Blockscout transaction: https://eth.blockscout.com/tx/0xb8d6664c5317bad149d2d3cd46794082580a5a2ae9b0cff74b7c9ab039b0c008
- Blockscout tx logs endpoint: https://eth.blockscout.com/api/v2/transactions/0xb8d6664c5317bad149d2d3cd46794082580a5a2ae9b0cff74b7c9ab039b0c008/logs
- Example liquidation analytics: https://app.blockworks.com/projects/aave/analytics/aave-liquidations
- Example liquidation protection: https://defisaver.com/features/automation
