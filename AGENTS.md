# RecoLab – Codex Development Instructions

## Product objective

Build a private research-analysis application that:

1. Reads selected Axis Direct recommendation emails from the user's Gmail account.
2. Extracts recommendations into an auditable structured format.
3. Retrieves historical Indian equity prices.
4. Simulates what would have happened under explicitly configured trading rules.
5. Never executes real trades.

This is an analytical tool, not an autonomous trading system.

## Required technology

- TypeScript throughout.
- Next.js with App Router.
- React for the user interface.
- Node.js server runtime.
- Prisma ORM.
- SQLite for the local PoC.
- Maintain PostgreSQL compatibility for future deployment.
- Gmail API through the official `googleapis` Node.js package.
- Zod for all external-input and parser-output validation.
- Vitest for unit and integration tests.
- Playwright for essential UI journeys.

Do not introduce Python unless a later specification explicitly requires it.

## Architecture boundaries

Maintain the following modules:

- `gmail`: OAuth, Gmail search, message retrieval and attachment retrieval.
- `parsing`: MIME parsing, HTML conversion, PDF extraction and recommendation extraction.
- `recommendations`: recommendation lifecycle and manual review.
- `market-data`: provider-independent historical-price access.
- `backtesting`: deterministic trade and portfolio simulation.
- `reporting`: metrics, charts and exports.
- `security`: encryption, token management and audit logging.

Business logic must not be implemented directly inside React components or route handlers.

## Non-negotiable rules

1. Gmail access must use only `https://www.googleapis.com/auth/gmail.readonly`.
2. Never request Gmail modify, compose, send or full-mailbox permissions.
3. Never send, delete, label, archive or modify an email.
4. Never commit OAuth credentials, refresh tokens, API keys, real emails or downloaded reports.
5. Do not store complete email bodies or PDF reports by default.
6. Persist Gmail message ID, source metadata, SHA-256 content hash, extracted fields, limited evidence snippets and parser version.
7. All AI/LLM extraction must be optional. Deterministic parsing is the default.
8. Every extracted recommendation must show its source email, extraction confidence, parser version and review status.
9. Backtests must not use information unavailable at the simulated time.
10. If target and stop occur inside the same daily candle and event order is unknown, classify it as ambiguous and use the pessimistic outcome in the primary result.
11. Never describe simulated performance as guaranteed or expected future profit.
12. No broker integration, trading API or order-placement capability is permitted in the MVP.
13. Never silently fabricate missing entry, target, stop, horizon, price or corporate-action data.
14. Preserve manual corrections across reparsing and parser upgrades.

## Development workflow

Before implementing a phase:

1. Read `specs/001-axis-recommendation-analyzer.md` completely.
2. State which requirements will be implemented.
3. Inspect the existing repository.
4. Propose a short file-level plan.
5. Implement only the requested phase.
6. Run formatting, linting, type checking and tests.
7. Report files changed, tests executed, assumptions, unresolved issues and the next recommended phase.

Do not silently change requirements to make implementation easier.

## Testing rules

Tests must use synthetic email fixtures. Do not commit real Axis Direct emails.

At minimum, cover:

- HTML and plain-text email parsing.
- PDF attachment extraction.
- Multiple recommendations and targets.
- Entry-price ranges.
- Missing stop-loss.
- Recommendation revisions and closures.
- Duplicate Gmail imports.
- Target and stop reached on the same candle.
- Price gaps through stop or target.
- Corporate-action detection.
- Missing-price history.
- Transaction-cost calculations.
- No-look-ahead behaviour.

## Quality gates

A phase is complete only when:

- TypeScript compiles without errors.
- Formatting and linting succeed.
- Automated tests pass.
- Secrets and personal data are excluded by `.gitignore`.
- Error and data-quality states are visible in the UI.
- Imported and simulated data can be audited.
- README instructions match the implementation.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
