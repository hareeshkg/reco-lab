# RecoLab

RecoLab is a local-first research-analysis tool for evaluating Axis Direct stock recommendations received through Gmail.

It is designed to:

- Connect to Gmail using read-only OAuth access.
- Identify and parse Axis Direct recommendation emails and PDF attachments.
- Extract recommendation date, stock, entry range, target, stop-loss and horizon.
- Retrieve historical NSE/BSE daily prices through a replaceable market-data provider.
- Run point-in-time "what would have happened" simulations without look-ahead bias.
- Model a configurable portfolio, initially using ₹1,00,000 capital.
- Show gross return, transaction costs, net return, drawdown and recommendation-level evidence.

RecoLab does **not** place trades or connect to a broker in the MVP.

## Specification pack

- [Codex development instructions](AGENTS.md)
- [Product and architecture specification](specs/001-axis-recommendation-analyzer.md)
- [Phase 1 implementation prompt](prompts/01-build-foundation.md)
- [Phase 2 implementation prompt](prompts/02-build-backtesting.md)
- [Environment template](.env.example)

## Recommended development flow

1. Clone this repository and open it in VS Code.
2. Install or enable the Codex extension.
3. Ask Codex to read `AGENTS.md` and the complete master specification.
4. Execute `prompts/01-build-foundation.md`.
5. Review the Gmail extraction results using synthetic fixtures and then real emails.
6. Execute `prompts/02-build-backtesting.md` only after Phase 1 tests pass.

Suggested initial instruction:

> Execute prompts/01-build-foundation.md. Read AGENTS.md and the complete product specification first. Stop after Phase 1 and show me all test results before proceeding.

## Important safeguards

- Gmail permission must remain `gmail.readonly`.
- Never commit OAuth credentials, refresh tokens, real emails or Axis Direct reports.
- AI extraction is optional and disabled by default.
- Backtests must be deterministic, auditable and free of look-ahead bias.
- Daily-candle ambiguity must be disclosed and treated pessimistically.
- Results are research outputs, not guaranteed future returns or investment advice.
