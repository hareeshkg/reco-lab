# RecoLab

A private, local recommendation research workspace. **Phase 0–1 is implemented:** Gmail connection, sender discovery, selected-message import, deterministic extraction, and auditable manual review. Market data, instrument normalization, backtesting, portfolios, and reporting are deferred. There is no broker or trade-execution capability.

## Local startup

Use Node.js 22.13+ (Node 24 LTS recommended) and npm. The lockfile pins the tested dependencies.

```sh
npm ci
cp .env.example .env
openssl rand -hex 32
```

Copy the generated hex value into `APP_ENCRYPTION_KEY` in `.env`. Keep this key private and stable: changing it makes existing encrypted tokens unreadable. Leave Google credentials empty to explore the disconnected UI, or follow the Google Cloud steps below.

```sh
npm run db:generate
npm run db:migrate
npm run dev
```

Open **http://localhost:3000**. Development and production scripts bind to localhost. Use that exact hostname, since API requests check the configured host and origin. Do not expose this single-user PoC through a public proxy or tunnel.

For a production build on your own machine:

```sh
npm run build
npm start
```

`DATABASE_URL=file:./recolab.db` resolves relative to `prisma/`. The migration wrapper creates a private empty database file before applying checked-in migrations; this also avoids Prisma 6's missing-file initialization failure observed during validation. Never use `migrate reset` against imported research. Back up the database and encryption key privately if needed.

## Google Cloud configuration

1. Open [Google Cloud Console](https://console.cloud.google.com/), create or select a project, then enable **Gmail API** under **APIs & Services → Library**.
2. Open **Google Auth Platform → Branding** (or **OAuth consent screen**). Set an app name such as RecoLab, your support email, and contact email.
3. Under **Audience**, choose **External** for a personal Gmail account. Keep the app in **Testing** and add your Gmail address as a test user. An organization-managed account can use Internal if its organization permits it.
4. Under **Data Access**, add only `https://www.googleapis.com/auth/gmail.readonly`. Do not add profile, OpenID, modify, compose, send, or full-mailbox scopes.
5. Under **Clients → Create client**, choose **Web application**. Add the exact authorized redirect URI `http://localhost:3000/api/auth/google/callback`. No browser API key is needed.
6. Copy the client ID and client secret into `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env`. Do not save the downloaded credentials JSON inside this repository.
7. Confirm `APP_BASE_URL=http://localhost:3000` and `GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback`. Restart the app after environment changes.
8. Open **Setup → Connect Gmail**, choose the test-user account, and grant read-only access. Verify the connected address and displayed scope. If Google shows an unverified-app prompt, confirm this is your own project before continuing.

The server requests offline access, validates a single-use, ten-minute OAuth state tied to an HttpOnly cookie, uses S256 PKCE, checks the granted scope, and encrypts the refresh token with AES-256-GCM. Access tokens stay in memory. Request URL logging is disabled to prevent OAuth codes from appearing in Next.js request logs.

External apps in Testing normally receive refresh tokens that expire after seven days for Gmail scopes; reconnect when Google rejects a token. See Google's [OAuth configuration guide](https://developers.google.com/workspace/gmail/api/quickstart/js), [server-side OAuth guide](https://developers.google.com/identity/protocols/oauth2/web-server), and [token expiration guidance](https://developers.google.com/identity/protocols/oauth2).

**Disconnect** deletes local tokens and pending OAuth state. To revoke the grant at Google, remove RecoLab from [Google account connections](https://myaccount.google.com/connections). Local disconnect does not delete imported recommendations. **Delete local data** requires typing the confirmation phrase and removes accounts, sources, imports, recommendations, evidence, and audit history. It does not modify Gmail or erase separate backups or filesystem recovery copies.

## Import and review

1. In **Inbox**, enter your own Gmail query. No Axis sender is assumed. Optional dates use UTC midnight, inclusive start and exclusive end, encoded as Unix seconds in Gmail queries.
2. Preview metadata. Load additional pages to inspect more messages. Counts from Gmail are estimates; date coverage describes the metadata pages loaded so far.
3. Select confirmed sender addresses and enter accepted subject substrings, one per line. Matching is case-insensitive and literal, not regular-expression matching. Confirm and save the source.
4. Select up to 50 messages and import. The server rechecks query membership, sender, subject, date range, and connected account before retrieving full message content or attachments. Completed imports are committed one message at a time. Retry the same selection after interruption; duplicates are skipped and failed records retried.
5. In **Review queue**, inspect fields, warnings, source metadata, evidence, confidence, and parser version. Open the original email in Gmail when needed. Correct fields with a reason, then approve or reject. Missing stops are never invented. Approval acknowledges warnings; it does not verify an instrument or make a recommendation eligible for future simulations automatically.
6. If parsing misses a call, use **Inbox → Import history → Add missed recommendation**. Enter values from the original source; this creates a manually protected record requiring review.

Every manual edit, approval, rejection, and reparse creates an immutable recommendation version. Corrections reset the review status. Reparse downloads the source again, preserves manual fields and every approved value, and refuses to remap records when extraction structure changes. Review proposed update relationships; an earlier recommendation ID can be supplied in the correction form. Updates and closures remain separate events at their own Gmail received timestamp, never edits to earlier calls.

## Parser coverage and limits

- Supports nested Gmail MIME parts, plain text, HTML converted to text, and text-based PDFs in memory. Multipart alternatives prefer nonempty plain text; identical body/PDF extractions are deduplicated.
- Recognizes labelled company/stock, NSE/BSE, category, report reference, action, CMP, entry ranges, multiple targets, stop-loss, upside, horizon, limited rationale, and timezone-qualified ISO publication time. Supports Indian comma grouping and lakh/crore values.
- All calls begin in Needs Review. Extraction confidence is a rules-based heuristic, not a calibrated probability. Symbols remain unverified until the Phase 2 instrument master exists.
- Layout-dependent tables, arbitrary prose, image-only/scanned PDFs, encrypted/damaged PDFs, and ambiguous formats may need manual entry. No OCR or AI extraction is implemented. Unsupported attachments and PDF failures appear as warnings.
- Limits: 20 MiB of supported decoded content per message, 100 PDF pages, MIME depth 20, and 50 selected messages per import request. PDF attachments are never written to disk.
- Content hashes cover source headers and supported MIME content encountered during parsing, including alternative bodies. Unsupported attachment bytes are not downloaded or hashed. Full email bodies and PDFs are not retained; evidence snippets are limited to 240 characters per field.
- Gmail received time is the conservative signal-availability and event-effective timestamp. Publication time is retained separately. Update matching tries reference, thread, provider/symbol/category, then an open symbol call within `UPDATE_MATCH_WINDOW_DAYS` (default 90). Ambiguous candidates remain unmatched for manual review.
- Import requests are sequential and resumable by retry, without a background worker. Large query verification can take time. List pages are bounded to 50 records; 5,000-message performance has not yet been benchmarked.

## Validation

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm audit
```

Tests use synthetic strings and PDFs generated in memory. Integration tests apply the actual migrations to temporary SQLite databases. Playwright starts its own localhost:3100 app and disposable synthetic database. Review and deletion journeys use the real API/database; the inbox browser journey mocks Gmail-facing responses. Tests never connect to your mailbox. A successful live Google consent and mailbox round-trip still requires your credentials and account consent.

## Architecture

- `src/app`, `src/components`: App Router pages and presentation.
- `src/modules/gmail`: official `googleapis` Gmail client, OAuth, discovery, selection and import services.
- `src/modules/parsing`: MIME/HTML/PDF conversion, deterministic extraction and Zod contracts.
- `src/modules/recommendations`: lifecycle, corrections, review decisions, versions and query services.
- `src/modules/security`: environment validation, encryption, origin protection, database and safe logging.
- `src/modules/market-data`, `backtesting`, `reporting`: reserved boundaries for later phases.
- `prisma`: SQLite schema and versioned migration. Provider-independent scalar fields and JSON-as-text avoid SQLite-only business queries. A future PostgreSQL deployment needs a provider change and regenerated migrations.
- `tests`: synthetic fixtures, unit/integration tests, and Playwright journeys.

Prisma 6 is pinned for its established SQLite client API. A `deepmerge-ts` override selects the patched version 8 used by Prisma's configuration dependency; migration, client generation, and tests validate this combination.

The [full specification](specs/001-axis-recommendation-analyzer.md), [development rules](AGENTS.md), and [foundation prompt](prompts/01-build-foundation.md) remain authoritative. Stop for Phase 1 review before implementing market data or backtesting.
