# Implementation Prompt 01: Foundation and Gmail Ingestion

Read `AGENTS.md` and `specs/001-axis-recommendation-analyzer.md` completely.

Implement Phase 0 and Phase 1 only.

## Required outcome

1. Scaffold the Next.js TypeScript application.
2. Configure Prisma with SQLite.
3. Implement environment validation.
4. Add Google OAuth using the official Gmail API client.
5. Request only the Gmail read-only scope.
6. Implement Gmail connection status and disconnect.
7. Implement configurable Gmail-query preview.
8. Let the user review sender addresses and subject patterns before saving a source.
9. Import selected messages idempotently.
10. Parse multipart email, HTML, plain text and PDF attachments.
11. Implement deterministic Axis recommendation extraction.
12. Implement a manual review, correction, approval and rejection screen.
13. Store source metadata, content hash, field evidence, confidence and parser version.
14. Add synthetic fixtures and automated tests.
15. Update README with exact Google Cloud and local startup instructions.

## Constraints

- Do not implement market-data retrieval or backtesting in this phase.
- Do not add broker integration.
- Do not request Gmail modify, send, compose or full-mailbox scopes.
- Do not commit real emails, attachments, tokens or credentials.
- AI extraction must remain disabled and unimplemented unless an interface stub is useful.
- Do not store raw message bodies or PDF reports after parsing.
- Keep business logic outside route handlers and React components.

## Required workflow

Before coding:

1. Inspect the repository.
2. Summarise the requirements being implemented.
3. Propose a file-level implementation plan.
4. List assumptions and any package decisions requiring confirmation.

After coding:

1. Run formatting.
2. Run linting.
3. Run TypeScript checking.
4. Run unit and integration tests.
5. Report files changed, tests executed, assumptions, known limitations and remaining work.
6. Stop after Phase 1 and wait for review before starting market data or backtesting.
