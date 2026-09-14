# Implementation Prompt 02: Market Data and Backtesting

Read `AGENTS.md` and `specs/001-axis-recommendation-analyzer.md` completely.

Verify that Phase 1 is complete and all existing tests pass. Then implement Phase 2 and Phase 3 only.

## Required outcome

1. Create the provider-neutral market-data interface.
2. Implement the deterministic CSV historical-data provider.
3. Implement the Yahoo Finance PoC provider.
4. Add instrument resolution for NSE `.NS` and BSE `.BO` symbols.
5. Persist immutable daily OHLCV datasets and hashes.
6. Add coverage validation and corporate-action warnings.
7. Implement the deterministic recommendation backtest engine.
8. Implement next-session-open, entry-range and recommended-price entries.
9. Implement target, stop, recommendation closure and horizon exits.
10. Handle gaps through target and stop correctly.
11. Handle same-candle target/stop ambiguity pessimistically.
12. Ensure recommendation revisions are never applied retroactively.
13. Implement configurable transaction-cost profiles.
14. Implement the first three default experiments in the specification.
15. Add detailed trade results, warnings and configuration snapshots.
16. Add comprehensive no-look-ahead and edge-case tests.
17. Add a backtest configuration page and results page.

## Constraints

- Do not add broker connectivity or real order placement.
- Do not silently forward-fill missing market data.
- Do not silently adjust recommendations across corporate actions.
- Do not describe Yahoo Finance data as official or exchange-grade.
- Do not calculate personal income tax.
- Preserve the original Axis recommendation separately from synthetic experiment rules.
- Freeze inputs used by every completed run.

## Required workflow

Before coding:

1. Inspect the Phase 1 implementation and test status.
2. Summarise requirements being implemented.
3. Propose a file-level implementation plan.
4. Identify the exact backtest invariants and monetary rounding rules.

After coding:

1. Run formatting, linting and TypeScript checking.
2. Run the full unit and integration test suite.
3. Run representative synthetic backtests.
4. Demonstrate the same-candle pessimistic outcome.
5. Demonstrate that a later recommendation update is not used earlier.
6. Report files changed, test results, assumptions, warnings and remaining work.
7. Stop after Phase 3 and wait for review before building portfolio simulation.
