# Phase 0–1 validation report

Validated on 2026-09-14 with Node.js 25.6.1, npm 11.11.1, Next.js 16.3.5, Prisma 6.19.3, Vitest 4.1.11, and Playwright 1.63.0 / Chromium 153.

**Result: 64 unit/integration tests and 6 browser/API journeys passed. No tests skipped. Phase 1 is ready for review; Phase 2 has not started.**

## Quality gates

| Check                                                | Result                                                                                               |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Formatting: `npm run format`, `npm run format:check` | PASS                                                                                                 |
| Lint: `npm run lint`                                 | PASS, zero warnings                                                                                  |
| TypeScript: `npm run typecheck`                      | PASS                                                                                                 |
| Unit/integration: `npm test`                         | PASS, 64/64, 4 files                                                                                 |
| Browser/API: `npm run test:e2e`                      | PASS, 6/6, 19.2 seconds                                                                              |
| Production build: `npm run build`                    | PASS                                                                                                 |
| Fresh SQLite migration: `npm run db:migrate`         | PASS, one migration applied                                                                          |
| Dependency audit: `npm audit`                        | PASS, zero reported vulnerabilities                                                                  |
| Whitespace: `git diff --check`                       | PASS                                                                                                 |
| Ignore rules                                         | PASS: environment files, databases, real email/PDF files, private data and browser artifacts ignored |
| Visual review                                        | PASS: synthetic review/evidence/history screenshot inspected                                         |

## All unit and integration results

### tests/ingestion.test.ts — 15 passed

| Test                                                                                                               | Result |
| ------------------------------------------------------------------------------------------------------------------ | ------ |
| Gmail ingestion with SQLite previews metadata only and exposes next-page cursor                                    | PASSED |
| Gmail ingestion with SQLite imports idempotently without retaining raw message bodies                              | PASSED |
| Gmail ingestion with SQLite checks sender and query membership before fetching full content                        | PASSED |
| Gmail ingestion with SQLite paginates selection verification                                                       | PASSED |
| Gmail ingestion with SQLite persists failures and resumes interrupted imports                                      | PASSED |
| Gmail ingestion with SQLite marks unrecognized content for review without inventing a call                         | PASSED |
| Gmail ingestion with SQLite isolates identical message IDs across Gmail accounts                                   | PASSED |
| manual review, lifecycle and audit creates a missed call with protected manual fields, evidence and warnings       | PASSED |
| manual review, lifecycle and audit preserves MIME quality warnings after field corrections                         | PASSED |
| manual review, lifecycle and audit versions corrections, approvals and rejection, with stale-write protection      | PASSED |
| manual review, lifecycle and audit preserves corrections and all approved values across reparse                    | PASSED |
| manual review, lifecycle and audit refuses structural reparse changes instead of moving manual corrections         | PASSED |
| manual review, lifecycle and audit stores revision and closure as timestamped events without rewriting prior calls | PASSED |
| manual review, lifecycle and audit does not match an update to information received later                          | PASSED |
| manual review, lifecycle and audit filters records by review, symbol, confidence and dates                         | PASSED |

### tests/oauth.test.ts — 6 passed

| Test                                                                                                                   | Result |
| ---------------------------------------------------------------------------------------------------------------------- | ------ |
| OAuth lifecycle with mocked Google responses generates only read-only scope, PKCE and encrypted expiring state         | PASSED |
| OAuth lifecycle with mocked Google responses connects the verified profile, encrypts the token and consumes state once | PASSED |
| OAuth lifecycle with mocked Google responses rejects mismatched and expired state before exchanging a code             | PASSED |
| OAuth lifecycle with mocked Google responses rejects overbroad granted scopes without storing an account               | PASSED |
| OAuth lifecycle with mocked Google responses requires a refresh token and leaves the user disconnected on failure      | PASSED |
| OAuth lifecycle with mocked Google responses disconnects previous accounts and deletes local tokens and pending state  | PASSED |

### tests/parsing.test.ts — 34 passed

| Test                                                                                                      | Result |
| --------------------------------------------------------------------------------------------------------- | ------ |
| deterministic extraction uses explicitly revised prices when old and new levels are both quoted           | PASSED |
| deterministic extraction rejects impossible calendar dates instead of normalizing them                    | PASSED |
| deterministic extraction extracts plain text, multiple targets, CMP, entry range, evidence and provenance | PASSED |
| deterministic extraction extracts multiple recommendations                                                | PASSED |
| deterministic extraction never manufactures missing stops or targets from upside                          | PASSED |
| deterministic extraction recognizes lifecycle Revised Target: 1,600                                       | PASSED |
| deterministic extraction recognizes lifecycle Revised Stop Loss: 1,150                                    | PASSED |
| deterministic extraction recognizes lifecycle Status: Closed                                              | PASSED |
| deterministic extraction recognizes lifecycle Status: Withdrawn                                           | PASSED |
| deterministic extraction recognizes lifecycle Target achieved                                             | PASSED |
| deterministic extraction recognizes lifecycle Reiterated BUY                                              | PASSED |
| deterministic extraction recognizes lifecycle Upgraded                                                    | PASSED |
| deterministic extraction recognizes lifecycle Downgraded                                                  | PASSED |
| deterministic extraction recognizes lifecycle Update                                                      | PASSED |
| deterministic extraction flags malformed numbers and inverted entry ranges                                | PASSED |
| deterministic extraction does not parse newsletters without a recommendation                              | PASSED |
| deterministic extraction rejects untrusted publication dates                                              | PASSED |
| deterministic extraction parses Indian numbers 1,00,000                                                   | PASSED |
| deterministic extraction parses Indian numbers 1.5 lakh                                                   | PASSED |
| deterministic extraction parses Indian numbers 2 crore                                                    | PASSED |
| deterministic extraction parses Indian numbers ₹1,234.50                                                  | PASSED |
| deterministic extraction parses Indian numbers Rs. 1,234                                                  | PASSED |
| deterministic extraction parses Indian numbers 1,2,3                                                      | PASSED |
| deterministic extraction parses Indian numbers NaN                                                        | PASSED |
| deterministic extraction parses Indian numbers -10                                                        | PASSED |
| deterministic extraction parses Indian numbers 123x                                                       | PASSED |
| deterministic extraction parses Indian numbers 1.2.3                                                      | PASSED |
| MIME and PDF converts HTML without fetching images or retaining markup                                    | PASSED |
| MIME and PDF deduplicates multipart alternatives and walks nested MIME                                    | PASSED |
| MIME and PDF extracts a real synthetic PDF-only attachment in memory                                      | PASSED |
| MIME and PDF flags unsupported attachments without downloading them                                       | PASSED |
| MIME and PDF flags damaged PDF and scanned PDF without text                                               | PASSED |
| MIME and PDF rejects oversized attachments before fetching                                                | PASSED |
| MIME and PDF produces stable hashes that change with content                                              | PASSED |

### tests/security.test.ts — 9 passed

| Test                                                                                                          | Result |
| ------------------------------------------------------------------------------------------------------------- | ------ |
| security and boundaries retries Gmail rate-limit 403 responses and caps retries                               | PASSED |
| security and boundaries validates local configuration and disables raw retention and AI                       | PASSED |
| security and boundaries encrypts tokens with randomized authenticated encryption                              | PASSED |
| security and boundaries rejects missing/mismatched OAuth state and broader scopes                             | PASSED |
| security and boundaries blocks hostile hosts and cross-site writes but allows OAuth callback state validation | PASSED |
| security and boundaries logs codes only, never arbitrary error contents                                       | PASSED |
| security and boundaries uses Unix seconds and validates date order                                            | PASSED |
| security and boundaries requires sender, literal subject and date matches                                     | PASSED |
| security and boundaries retries throttling exponentially and stops on authorization errors                    | PASSED |

## All browser/API results

| Journey                                                                              | Result |
| ------------------------------------------------------------------------------------ | ------ |
| setup shows read-only scope and OAuth uses PKCE                                      | PASS   |
| review corrects, approves, audits and rejects a synthetic recommendation             | PASS   |
| inbox requires source confirmation and message selection with mocked Gmail transport | PASS   |
| API blocks cross-origin writes and exposes disconnected import errors                | PASS   |
| manual entry adds a missed recommendation with source evidence                       | PASS   |
| local data deletion requires explicit confirmation and clears imports                | PASS   |

Browser review, manual entry, approval/rejection, source audit and deletion use the real application API and SQLite database. Gmail-facing inbox responses are mocked. OAuth tests use synthetic client credentials and mock Google's token/profile responses. No real Gmail account, emails, reports, tokens or client credentials were used.

## Issues found and resolved during validation

- The first parser run passed 50 tests and failed three update/upgrade/downgrade cases. The recognition gate was corrected; all now pass.
- Additional regression tests cover revised prices when old values remain in the email, invalid calendar dates, manual-entry provenance, retained MIME warnings after correction, and Gmail rate-limit 403 responses.
- Initial lint findings concerned effect state updates and OAuth navigation; these were corrected without disabling lint rules.
- Prisma's initial missing-database path failed. The documented migration wrapper initializes the file first. Its environment-loader ESM import was also corrected and a fresh database migration verified.
- Initial Playwright attempts were blocked by sandbox IPC restrictions and then an absent matching Chromium binary. After installing the correct browser and allowing the local test runner, all journeys passed.
- npm initially reported three related high-severity findings through Prisma's deepmerge dependency. The patched deepmerge-ts 8 override removed those findings; generation, migrations, tests and build pass with it.
- Next.js added its managed documentation guidance block to AGENTS.md when starting the test server. Existing project instructions are preserved.
- Browser runner output contains harmless NO_COLOR/FORCE_COLOR notices. Expected negative security tests emit sanitized error codes, without request contents.

## Assumptions and remaining validation

- This is a single-user localhost application. Sender addresses and literal subject patterns require user confirmation; none are assumed for Axis Direct.
- Gmail received time is used conservatively for availability and lifecycle effectiveness. Instrument normalization is explicitly deferred to Phase 2.
- Deterministic parsing supports labelled text and text-based PDFs. Arbitrary tables/prose, scanned PDFs and damaged/encrypted attachments can require manual entry; warnings remain visible. No OCR or AI extraction exists.
- Confidence scores are rule heuristics. Every imported recommendation requires review; missing prices and stops are not fabricated.
- Live Google consent, refresh and mailbox import remain unverified until the user supplies Google Cloud credentials and grants access. The README documents the exact steps.
- Imports are synchronous in batches of at most 50 and resume by retrying the selection. The 5,000-message performance target has not been benchmarked.
- PostgreSQL migration and all market-data/backtesting tests belong to later phases and were not run or implemented.
- No changes were committed or pushed. No market-data retrieval, simulations or broker capability were implemented.

## Files changed

Existing files: `.env.example`, `README.md`, and the Next.js-managed addition to `AGENTS.md`.

New files:

- `.gitignore`
- `.prettierignore`
- `eslint.config.mjs`
- `next-env.d.ts`
- `next.config.ts`
- `package-lock.json`
- `package.json`
- `playwright.config.ts`
- `prisma/migrations/20260914192858_foundation/migration.sql`
- `prisma/migrations/migration_lock.toml`
- `prisma/schema.prisma`
- `scripts/db-migrate.ts`
- `src/app/api/[...path]/route.ts`
- `src/app/globals.css`
- `src/app/inbox/page.tsx`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/recommendations/page.tsx`
- `src/app/review/page.tsx`
- `src/app/setup/page.tsx`
- `src/components/api-client.ts`
- `src/components/inbox.tsx`
- `src/components/review.tsx`
- `src/components/setup.tsx`
- `src/modules/api.ts`
- `src/modules/backtesting/README.md`
- `src/modules/gmail/client.ts`
- `src/modules/gmail/contracts.ts`
- `src/modules/gmail/ingestion.ts`
- `src/modules/gmail/oauth.ts`
- `src/modules/market-data/README.md`
- `src/modules/parsing/contracts.ts`
- `src/modules/parsing/extract.ts`
- `src/modules/parsing/mime.ts`
- `src/modules/recommendations/service.ts`
- `src/modules/recommendations/views.ts`
- `src/modules/reporting/README.md`
- `src/modules/security/crypto.ts`
- `src/modules/security/db.ts`
- `src/modules/security/env.ts`
- `src/modules/security/errors.ts`
- `src/modules/security/http.ts`
- `src/modules/security/settings.ts`
- `tests/database.ts`
- `tests/e2e-server.ts`
- `tests/e2e/journeys.spec.ts`
- `tests/fixtures/messages.ts`
- `tests/ingestion.test.ts`
- `tests/oauth.test.ts`
- `tests/parsing.test.ts`
- `tests/security.test.ts`
- `tsconfig.json`
- `vitest.config.ts`
- `docs/phase-1-validation.md` (this report)

## Review handoff

Follow the README startup instructions, connect your Gmail account, and review extraction on a small selected sample. Review this phase before authorizing Phase 2 (market data). Backtesting requires its later phase separately.
