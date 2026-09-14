# RecoLab: Axis Direct Recommendation Analyzer

**Status:** Implementation specification  
**Initial user:** Single user  
**Initial capital model:** ₹1,00,000  
**Execution mode:** Simulation only  
**Primary exchange:** NSE  
**Secondary exchange:** BSE  
**Application mode:** Local/private web application

## 1. Business problem

The user receives stock recommendations from Axis Direct through Gmail. A recommendation may contain a company, symbol, recommended price or entry range, one or more targets, stop-loss, expected upside, recommendation category and holding horizon.

There is currently no reliable way to determine:

- How many recommendations reached their stated targets.
- How many reached a stop-loss first.
- Whether a recommendation was still actionable when received.
- Which research categories performed best.
- What happened when every eligible recommendation was followed.
- Whether a minimum-upside or entry-discipline filter improved outcomes.
- How a constrained ₹1,00,000 portfolio would have performed.
- How transaction costs changed the outcome.

RecoLab shall convert selected emails into structured recommendations and perform reproducible point-in-time simulations.

## 2. Product objective

Create an evidence-based analysis flow:

Axis Direct email → structured recommendation → human validation → historical market data → deterministic backtest → auditable results.

The application evaluates historical outcomes. It must not predict future prices, issue personalised investment advice or execute trades.

## 3. MVP scope

### Included

- Google OAuth and Gmail read-only access.
- Configurable Gmail query and date range.
- Sender and subject discovery before import.
- HTML, plain-text and PDF attachment parsing.
- Structured recommendation extraction.
- Manual review, correction, approval and rejection.
- Recommendation-update and closure handling.
- NSE/BSE instrument mapping.
- Provider-neutral historical daily OHLCV access.
- Individual recommendation simulation.
- ₹1,00,000 portfolio simulation.
- Configurable transaction-cost and slippage model.
- Dashboard, audit trail and CSV/JSON export.
- Gmail disconnect and local-data deletion.

### Excluded

- Real trade placement.
- Broker account integration.
- Intraday or tick-level backtesting.
- Options, futures, leverage, short selling or margin.
- Automated investment advice.
- Tax-return calculation.
- News or social sentiment.
- Multi-user access.
- Public hosting.
- Automatic email sending or modification.

## 4. User journeys

### Connect Gmail

1. Open Setup.
2. Select Connect Gmail.
3. Start Google OAuth with only `gmail.readonly`.
4. Grant access.
5. Display the connected email address and granted scope.
6. Allow disconnect and local-token deletion.

### Discover Axis Direct messages

1. Enter a Gmail search query and date range.
2. Run a metadata preview.
3. Show sender addresses, common subjects, date coverage and message count.
4. Let the user confirm valid sender and subject patterns.
5. Save the source configuration.

Do not hardcode an assumed Axis Direct sender until confirmed from the user's mailbox.

### Import and review

1. Import matching messages.
2. Parse MIME content and supported attachments.
3. Extract one or more recommendations from each message.
4. Route incomplete or ambiguous results to Needs Review.
5. Display field-level evidence and confidence.
6. Let the user correct extracted values.
7. Approve or reject the recommendation.
8. Version every manual correction.

### Run a backtest

1. Select approved recommendations.
2. Select entry, exit, cost and portfolio rules.
3. Validate market-data coverage and corporate actions.
4. Run an immutable point-in-time simulation.
5. Show aggregate metrics and every simulated decision.
6. Export the configuration, trades, warnings and results.

## 5. Gmail requirements

- Use the official Gmail API and server-side OAuth 2.0.
- Request only `https://www.googleapis.com/auth/gmail.readonly`.
- Use OAuth state validation and PKCE where supported.
- Keep OAuth client secret and refresh token on the server.
- Search with `users.messages.list`.
- Retrieve selected messages with `users.messages.get` and `format=full`.
- Retrieve attachment bodies only for selected matching messages.
- Support pagination and exponential backoff.
- Import idempotently using Gmail message ID.
- Use Unix timestamps for date-bounded search queries.
- Support `text/plain`, `text/html`, `application/pdf` and nested multipart content.
- Never send, modify, label, archive or delete messages.
- Provide a disconnect operation and token-revocation guidance.

## 6. Recommendation extraction contract

Extract when present:

- Research provider.
- Research category or report name.
- Report/reference identifier.
- Publication date and time.
- Gmail received timestamp.
- Company name.
- NSE symbol.
- BSE code.
- Recommendation action.
- Current/recommended market price.
- Entry-price lower and upper bounds.
- One or more target prices.
- Stop-loss.
- Stated upside percentage.
- Stated holding horizon.
- Recommendation rationale.
- Recommendation status.
- Relationship to an earlier recommendation.

### Extraction rules

- Preserve original currency and numeric evidence.
- Handle Indian lakh/crore expressions and comma grouping.
- Validate symbols against the instrument master before normalisation.
- Store evidence snippet, confidence and extraction method per field.
- Never invent a missing stop-loss.
- A target derived from stated upside must be marked as derived.
- Run deterministic rules before optional AI extraction.
- Validate optional AI output against a strict Zod schema.
- AI output must never overwrite manually approved values.
- Do not retain complete email bodies or reports by default.

## 7. Recommendation lifecycle

Supported events:

- NEW
- REITERATED
- TARGET_REVISED
- STOP_REVISED
- UPGRADED
- DOWNGRADED
- CLOSED
- WITHDRAWN
- TARGET_ACHIEVED
- UNKNOWN_UPDATE

Match an update using the strongest available evidence:

1. Explicit report/reference identifier.
2. Gmail thread relationship.
3. Provider, symbol and category.
4. Symbol plus an existing open call within a configurable period.

Low-confidence matches require manual review. An update is effective only from its own available timestamp; it must never be applied retroactively.

## 8. Market-data architecture

Define a provider-neutral interface:

- `resolveInstrument(query)`
- `getDailyCandles(instrument, from, to)`
- `getCorporateActions(instrument, from, to)`
- `getTradingCalendar(exchange, year)`

Initial adapters:

1. CSV provider for deterministic fixtures and offline analysis.
2. Yahoo Finance adapter for PoC convenience.

The Yahoo adapter is best-effort, not exchange-grade or authoritative. Keep provider logic isolated so a licensed data source or broker market-data API can replace it later.

Persist:

- Instrument and exchange.
- Provider symbol.
- Trading date.
- Raw open, high, low and close.
- Adjusted close when available.
- Volume.
- Provider name.
- Retrieval timestamp.
- Dataset hash.

Detect splits, bonuses, mergers, symbol changes and other corporate actions. A recommendation crossing an unresolved corporate action must be flagged instead of silently producing a result.

## 9. Backtest integrity rules

Every run must be immutable and reproducible. Persist:

- Complete configuration snapshot.
- Recommendation versions.
- Market-data provider.
- Dataset hash.
- Parser version.
- Application version.
- Start and completion time.
- Data-quality warnings.

### Signal availability

Use the report publication time when trustworthy; otherwise use Gmail received time. The default daily-data model enters no earlier than the next trading session. This conservative delay prevents using a recommendation before it was available.

### Entry strategies

- NEXT_SESSION_OPEN
- ENTRY_RANGE_LIMIT
- RECOMMENDED_PRICE_LIMIT

Default: NEXT_SESSION_OPEN.

For ENTRY_RANGE_LIMIT:

- Wait a configurable number of trading sessions, default five.
- If the session opens inside the range, fill at open.
- If it opens below the lower bound but above the stop, fill at open.
- If it opens above the upper bound and later trades into the range, fill at the upper bound.
- If the range is never reached, classify as NO_ENTRY.
- If the first executable price is already below the stated stop, do not enter and flag the recommendation.

### Exit strategies

- FIRST_TARGET
- FINAL_TARGET
- STOP_OR_TARGET
- AXIS_CLOSE_OR_TARGET
- FIXED_HORIZON
- TRAILING_STOP
- PARTIAL_TARGET

Default: stop, first target, recommendation closure or horizon—whichever becomes executable first.

### Gap rules

- If a session opens below the stop, exit at the opening price.
- If a session opens above the target, exit at the opening price.
- Do not assume execution at a better historical level that was unavailable.

### Same-candle ambiguity

If target and stop both fall inside the daily high/low range:

- Set `intradaySequenceUnknown=true`.
- Use stop-first for the primary pessimistic result.
- Calculate a separate optimistic result.
- Include the trade in an ambiguity count.

### Horizon and missing data

- Use the recommendation's stated horizon when available.
- Otherwise use an experiment-specific horizon.
- At expiry, close at the final eligible session close.
- Never forward-fill a suspended or missing session as an executable price.
- Exclude or flag recommendations without sufficient data.

## 10. Default experiments

### Experiment 1: Buy every approved call

- Capital: ₹1,00,000.
- Maximum deployed capital: ₹90,000.
- Cash reserve: ₹10,000.
- Maximum positions: five.
- Target allocation: ₹18,000.
- Fractional shares: not allowed.
- Entry: next-session open.
- Exit: first target, stop, recommendation closure or stated horizon.
- One active position per symbol.
- No leverage.

### Experiment 2: Minimum remaining upside

Use Experiment 1 rules but enter only when:

`(targetPrice - actualEntryPrice) / actualEntryPrice >= 15%`

### Experiment 3: Entry-range discipline

Enter only when the price reaches the stated recommendation range within five trading sessions.

### Experiment 4: Risk-controlled synthetic exit

- Use the Axis stop when present.
- Do not silently manufacture a missing stop.
- Optional experiment-only synthetic stop: 7%.
- Optional partial exit: sell 50% at 10% profit.
- Remaining position: target or 5% trailing stop.

Always distinguish Axis rules from synthetic experiment rules.

## 11. Portfolio rules

- Initial cash: ₹1,00,000.
- Maximum open positions: five.
- Position quantity: floor(allocation divided by executable entry price).
- Unused allocation remains cash.
- No fractional shares.
- No leverage or negative cash.
- One active position per symbol.
- When capacity is unavailable, classify the recommendation as SKIPPED_CAPACITY.

Priority policies:

- FIRST_AVAILABLE
- HIGHEST_REMAINING_UPSIDE
- HIGHEST_EXTRACTION_CONFIDENCE
- USER_DEFINED_SCORE

Default to FIRST_AVAILABLE to reduce optimisation bias.

## 12. Transaction-cost model

All costs must be configurable:

- brokerageBuyBps
- brokerageSellBps
- brokerageMaximum
- sttBuyBps
- sttSellBps
- exchangeTransactionBuyBps
- exchangeTransactionSellBps
- sebiTurnoverBps
- stampDutyBuyBps
- gstPercent
- dpChargePerSell
- slippageBuyBps
- slippageSellBps
- otherFixedCharge

Provide:

- Zero-cost profile.
- User-defined profile.
- Clearly labelled illustrative delivery profile.

Personal income tax and tax-return preparation are outside the trade-return calculation. Never claim the illustrative cost profile exactly represents the user's NRI or broker tax treatment.

## 13. Metrics

### Recommendation-level

- Imported messages.
- Parsed and approved recommendations.
- Review-required and rejected records.
- No-entry count.
- Target-hit rate.
- Stop-hit rate.
- Horizon-expiry rate.
- Recommendation-close rate.
- Median time to target.
- Median holding period.
- Maximum favourable excursion.
- Maximum adverse excursion.
- Average gross and net return.
- Ambiguous-candle count.

### Portfolio-level

- Initial and ending capital.
- Absolute and time-weighted return.
- CAGR only for a sufficiently long period.
- Maximum drawdown.
- Profit factor.
- Win rate.
- Average win and loss.
- Expectancy per trade.
- Capital utilisation.
- Average concurrent positions.
- Total transaction cost.
- Monthly return series.
- NIFTY 50 benchmark comparison.

Do not annualise a short period without prominently displaying the assumption.

## 14. Core data model

### GmailAccount

`id, email, encryptedRefreshToken, scope, connectedAt, disconnectedAt, createdAt, updatedAt`

### EmailSource

`id, provider, gmailQuery, acceptedSendersJson, subjectPatternsJson, active, createdAt, updatedAt`

### SourceMessage

`id, gmailMessageId, gmailThreadId, sourceId, receivedAt, sentAt, fromAddress, subject, contentSha256, hasPdfAttachment, importStatus, parserVersion, importedAt, errorCode, errorMessage`

### Recommendation

`id, sourceMessageId, provider, category, publishedAt, availableAt, companyName, instrumentId, action, recommendedPrice, entryLow, entryHigh, primaryTarget, stopLoss, statedUpsidePercent, horizonMinDays, horizonMaxDays, status, extractionConfidence, reviewStatus, approvedAt, createdAt, updatedAt`

### RecommendationTarget

`id, recommendationId, sequence, price, label`

### RecommendationEvent

`id, recommendationId, sourceMessageId, eventType, effectiveAt, previousValuesJson, newValuesJson, matchConfidence, reviewStatus`

### FieldEvidence

`id, recommendationId, fieldName, extractedValue, evidenceSnippet, confidence, extractionMethod`

### Instrument

`id, exchange, symbol, companyName, isin, providerSymbol, activeFrom, activeTo`

### DailyCandle

`id, instrumentId, provider, tradingDate, open, high, low, close, adjustedClose, volume, retrievedAt, datasetHash`

Unique constraint: `instrumentId + provider + tradingDate`.

### CorporateAction

`id, instrumentId, actionType, effectiveDate, ratio, source, resolutionStatus`

### CostProfile

`id, name, configJson, createdAt, updatedAt`

### BacktestConfiguration

`id, name, initialCapital, entryStrategy, exitStrategy, targetPolicy, entryWindowSessions, defaultHorizonSessions, syntheticStopPercent, trailingStopPercent, maximumPositions, allocationPercent, cashReservePercent, minimumRemainingUpside, costProfileId, configurationJson`

### BacktestRun

`id, configurationId, configurationSnapshotJson, status, startedAt, completedAt, recommendationSetHash, marketDataHash, applicationVersion, warningsJson, metricsJson`

### SimulatedTrade

`id, runId, recommendationId, quantity, signalAvailableAt, entryDate, entryPrice, grossEntryValue, exitDate, exitPrice, exitReason, grossReturn, netReturn, transactionCost, maximumFavourableExcursion, maximumAdverseExcursion, holdingSessions, intradaySequenceUnknown, notesJson`

## 15. Application pages

### `/setup`

Gmail connection, OAuth scope, market-data provider and data-retention controls.

### `/inbox`

Gmail query, date range, metadata preview, sender discovery, import progress and message status.

### `/review`

Extracted fields, evidence, confidence, source metadata, manual correction and approval.

### `/recommendations`

Searchable table with date, category, symbol, status and confidence filters.

### `/backtests/new`

Recommendation filters, entry rules, exit rules, cost profile, portfolio settings, warnings and run action.

### `/backtests/[id]`

Metrics, equity curve, drawdown, monthly returns, exit distribution, trades, ambiguity disclosure, warnings and configuration snapshot.

## 16. Internal API

### Authentication

- `GET /api/auth/google`
- `GET /api/auth/google/callback`
- `POST /api/auth/google/disconnect`
- `GET /api/auth/status`

### Gmail

- `POST /api/gmail/preview`
- `POST /api/gmail/import`
- `GET /api/gmail/imports/[id]`

### Recommendations

- `GET /api/recommendations`
- `GET /api/recommendations/[id]`
- `PATCH /api/recommendations/[id]`
- `POST /api/recommendations/[id]/approve`
- `POST /api/recommendations/[id]/reject`
- `POST /api/recommendations/[id]/reparse`

### Market data

- `POST /api/market-data/sync`
- `GET /api/market-data/coverage`
- `POST /api/instruments/resolve`

### Backtests

- `POST /api/backtests`
- `GET /api/backtests`
- `GET /api/backtests/[id]`
- `GET /api/backtests/[id]/trades`
- `GET /api/backtests/[id]/export`

Validate every request and response boundary with Zod.

## 17. Security requirements

- Remain single-user and local-only during the PoC.
- Bind the development server to localhost by default.
- Keep OAuth secrets, refresh tokens and market-data keys server-side.
- Encrypt stored refresh tokens with an environment-supplied key.
- Validate OAuth state and use PKCE where supported.
- Never log tokens, authorisation codes, full emails or report contents.
- Delete temporary attachments after parsing.
- Store minimal evidence snippets only.
- Exclude secrets, tokens, databases, real emails and reports in `.gitignore`.
- Optional AI parsing is disabled by default.
- Never transmit email content to an AI provider without explicit opt-in.

## 18. Non-functional requirements

- Resume interrupted imports.
- Make re-import idempotent.
- Record parser versions.
- Preserve manual corrections across reparsing.
- Produce deterministic results for identical inputs.
- Freeze data and configuration used by completed runs.
- Show every warning in run results.
- Trace every recommendation to source metadata.
- Support at least 5,000 imported messages and 100,000 daily candles locally.
- Load normal local result pages within approximately two seconds after initial processing.

## 19. Minimum test catalogue

### Parsing

- HTML recommendation.
- Plain-text recommendation.
- PDF-only recommendation.
- Multiple recommendations in one email.
- Multiple targets.
- Entry range and CMP formats.
- Missing stop-loss.
- Revised target or stop.
- Closed/withdrawn call.
- Duplicate import.
- Unsupported attachment.
- Malformed numeric values.
- Email containing no recommendation.

### Backtesting

- Target before stop.
- Stop before target.
- Target and stop in the same candle.
- Gap below stop.
- Gap above target.
- Entry range never reached.
- Missing history.
- Trading suspension.
- Recommendation update after entry.
- Horizon expiry.
- Insufficient cash.
- Portfolio capacity reached.
- Duplicate symbol while open.
- Corporate action during holding.
- Transaction-cost calculation.
- No-look-ahead enforcement.

## 20. Delivery phases

### Phase 0: Foundation

Next.js, TypeScript, Prisma, SQLite, application shell, domain types, synthetic fixtures, tests, environment validation and security-safe logging.

### Phase 1: Gmail ingestion

OAuth, setup, query preview, sender discovery, import, MIME/PDF parsing, deterministic extraction, review queue, manual approval and audit trail.

### Phase 2: Market data

Instrument master, provider interface, CSV provider, Yahoo PoC provider, OHLCV persistence, coverage view and corporate-action warnings.

### Phase 3: Recommendation backtesting

Entry/exit engine, ambiguity handling, cost profiles, individual trade results, immutable snapshots and no-look-ahead tests.

### Phase 4: Portfolio simulation

₹1,00,000 cash ledger, allocation constraints, competing-call priority, equity curve, drawdown and NIFTY benchmark.

### Phase 5: Reporting

Dashboard, charts, experiment comparison, export and data-quality report.

## 21. MVP acceptance criteria

The MVP is accepted when:

1. Gmail can be connected and disconnected.
2. The only Gmail scope is `gmail.readonly`.
3. Selected Axis Direct messages can be previewed and imported.
4. Duplicate imports do not create duplicate recommendations.
5. Extracted data can be reviewed, corrected and approved.
6. Source evidence and parser provenance are visible.
7. Historical prices can be retrieved or imported.
8. The default experiments can run.
9. Entry and update rules prevent look-ahead bias.
10. Ambiguous daily candles are disclosed and handled pessimistically.
11. The ₹1,00,000 portfolio respects cash and position limits.
12. Gross return, costs and net return are separate.
13. Completed runs are reproducible.
14. No real trading action exists.
15. Critical scenarios have automated tests.
