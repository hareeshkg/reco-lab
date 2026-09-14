"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { z } from "zod";
import { api, errorText } from "./api-client";
import {
  importResultSchema,
  previewSchema,
  type MessageMetadata,
} from "@/modules/gmail/contracts";

const sourceSchema = z.object({
  id: z.string(),
  gmailQuery: z.string(),
  accountEmail: z.string(),
  acceptedSendersJson: z.string(),
  subjectPatternsJson: z.string(),
  after: z.string().nullable(),
  before: z.string().nullable(),
});
const importsSchema = z.object({
  records: z.array(
    z.object({
      id: z.string(),
      subject: z.string(),
      importStatus: z.string(),
      errorCode: z.string().nullable(),
      warnings: z.array(z.string()),
    }),
  ),
  total: z.number(),
  page: z.number(),
});
export function Inbox() {
  const [query, setQuery] = useState("");
  const [after, setAfter] = useState("");
  const [before, setBefore] = useState("");
  const [messages, setMessages] = useState<MessageMetadata[]>([]);
  const [nextPage, setNextPage] = useState<string | null>(null);
  const [estimatedTotal, setEstimatedTotal] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [senders, setSenders] = useState<string[]>([]);
  const [subjects, setSubjects] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [sources, setSources] = useState<z.infer<typeof sourceSchema>[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<z.infer<
    typeof importResultSchema
  > | null>(null);
  const [imports, setImports] = useState<z.infer<typeof importsSchema> | null>(
    null,
  );
  async function refresh(page = 1) {
    const [sources, imports] = await Promise.all([
      api("gmail/sources", z.array(sourceSchema)),
      api(`gmail/imports?page=${page}`, importsSchema),
    ]);
    setSources(sources);
    setImports(imports);
  }
  useEffect(() => {
    Promise.all([
      api("gmail/sources", z.array(sourceSchema)),
      api("gmail/imports?page=1", importsSchema),
    ])
      .then(([sources, imports]) => {
        setSources(sources);
        setImports(imports);
      })
      .catch((error) => setError(errorText(error)));
  }, []);
  function invalidate() {
    setSourceId("");
    setConfirmed(false);
    setMessages([]);
    setSelected([]);
    setNextPage(null);
  }
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  async function preview(pageToken?: string) {
    await run(async () => {
      const result = await api("gmail/preview", previewSchema, "POST", {
        query,
        ...(after ? { after } : {}),
        ...(before ? { before } : {}),
        ...(pageToken ? { pageToken } : {}),
      });
      setMessages((current) =>
        pageToken
          ? [
              ...current,
              ...result.messages.filter(
                (message) => !current.some((other) => other.id === message.id),
              ),
            ]
          : result.messages,
      );
      setNextPage(result.nextPageToken);
      setEstimatedTotal(result.estimatedTotal);
      if (!pageToken) setSelected([]);
    });
  }
  async function save() {
    await run(async () => {
      const source = await api("gmail/sources", sourceSchema, "POST", {
        provider: "Axis Direct",
        query,
        ...(after ? { after } : {}),
        ...(before ? { before } : {}),
        acceptedSenders: senders,
        subjectPatterns: subjects
          .split("\n")
          .map((text) => text.trim())
          .filter(Boolean),
        confirmed,
      });
      setSourceId(source.id);
      await refresh();
    });
  }
  function loadSource(id: string) {
    const source = sources.find((source) => source.id === id);
    invalidate();
    setSourceId(id);
    if (source) {
      setQuery(source.gmailQuery);
      setAfter(source.after ?? "");
      setBefore(source.before ?? "");
      setSenders(
        z.array(z.string()).parse(JSON.parse(source.acceptedSendersJson)),
      );
      setSubjects(
        z
          .array(z.string())
          .parse(JSON.parse(source.subjectPatternsJson))
          .join("\n"),
      );
      setConfirmed(true);
    }
  }
  async function importSelected() {
    await run(async () => {
      setResults(
        await api("gmail/import", importResultSchema, "POST", {
          sourceId,
          messageIds: selected,
        }),
      );
      await refresh();
    });
  }
  const discoveredSenders = [
    ...new Set(messages.map((message) => message.from)),
  ];
  const discoveredSubjects = [
    ...new Set(messages.map((message) => message.subject)),
  ];
  const dates = messages.map((message) => message.receivedAt).sort();
  return (
    <>
      <p className="eyebrow">DISCOVER → CONFIRM → IMPORT</p>
      <h1>Research inbox</h1>
      <p className="lead">
        Preview metadata before retrieving message content. Sender addresses are
        yours to confirm.
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {busy && (
        <p role="status">
          Working… Imports are processed sequentially. Completed messages are
          saved; retrying skips duplicates.
        </p>
      )}
      <section className="panel">
        <label>
          Saved source
          <select
            value={sourceId}
            disabled={busy}
            onChange={(event) => loadSource(event.target.value)}
          >
            <option value="">New source</option>
            {sources.map((source) => (
              <option value={source.id} key={source.id}>
                {source.gmailQuery} · {source.accountEmail}
              </option>
            ))}
          </select>
        </label>
        <label>
          Gmail query
          <input
            placeholder="Enter a Gmail search query"
            value={query}
            disabled={busy}
            onChange={(event) => {
              invalidate();
              setQuery(event.target.value);
            }}
          />
        </label>
        <div className="row">
          <label>
            From date (UTC, inclusive)
            <input
              type="date"
              value={after}
              disabled={busy}
              onChange={(event) => {
                invalidate();
                setAfter(event.target.value);
              }}
            />
          </label>
          <label>
            Before date (UTC, exclusive)
            <input
              type="date"
              value={before}
              disabled={busy}
              onChange={(event) => {
                invalidate();
                setBefore(event.target.value);
              }}
            />
          </label>
        </div>
        <button disabled={busy || !query.trim()} onClick={() => preview()}>
          Preview metadata
        </button>
      </section>
      {messages.length > 0 && (
        <>
          <section className="panel">
            <h2>Confirm the source</h2>
            <p>
              {messages.length} metadata records loaded · Gmail estimate:{" "}
              {estimatedTotal} · UTC coverage: {dates[0]?.slice(0, 10)} to{" "}
              {dates.at(-1)?.slice(0, 10)}
            </p>
            <h3>Discovered senders</h3>
            {discoveredSenders.map((sender) => (
              <label key={sender}>
                <input
                  type="checkbox"
                  disabled={busy}
                  checked={senders.includes(sender)}
                  onChange={(event) => {
                    setSourceId("");
                    setConfirmed(false);
                    setSenders(
                      event.target.checked
                        ? [...senders, sender]
                        : senders.filter((value) => value !== sender),
                    );
                  }}
                />
                {sender}
              </label>
            ))}
            <details>
              <summary>Discovered subjects</summary>
              <ul>
                {discoveredSubjects.map((subject) => (
                  <li key={subject}>{subject}</li>
                ))}
              </ul>
            </details>
            <label>
              Accepted subject patterns — one literal substring per line
              <textarea
                value={subjects}
                disabled={busy}
                onChange={(event) => {
                  setSourceId("");
                  setConfirmed(false);
                  setSubjects(event.target.value);
                }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              I reviewed these senders and subject patterns and confirm they
              identify my Axis Direct research.
            </label>
            <button
              disabled={
                busy || !confirmed || !senders.length || !subjects.trim()
              }
              onClick={save}
            >
              Save confirmed source
            </button>
            {sourceId && <span className="badge">SOURCE SAVED</span>}
          </section>
          <section className="panel">
            <h2>Select messages</h2>
            <p>
              Import up to 50 selected messages per batch. Selection is checked
              against the saved query, senders, and subjects.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Sender</th>
                    <th>Subject</th>
                    <th>Received (UTC)</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((message) => (
                    <tr key={message.id}>
                      <td>
                        <input
                          aria-label={`Select ${message.subject}`}
                          type="checkbox"
                          disabled={
                            busy ||
                            (!selected.includes(message.id) &&
                              selected.length >= 50)
                          }
                          checked={selected.includes(message.id)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...selected, message.id]
                                : selected.filter((id) => id !== message.id),
                            )
                          }
                        />
                      </td>
                      <td>{message.from}</td>
                      <td>{message.subject}</td>
                      <td>{message.receivedAt.slice(0, 16)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              {nextPage && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => preview(nextPage)}
                >
                  Load next page
                </button>
              )}
              <button
                disabled={busy || !sourceId || !confirmed || !selected.length}
                onClick={importSelected}
              >
                Import selected ({selected.length})
              </button>
            </div>
          </section>
        </>
      )}
      {results && (
        <section className="panel">
          <h2>Batch results</h2>
          {results.results.map((result) => (
            <p key={result.gmailMessageId}>
              <code>{result.gmailMessageId}</code> · {result.status}{" "}
              {result.error && <strong>{result.error}</strong>}
            </p>
          ))}
          <Link href="/review">Open review queue →</Link>
        </section>
      )}
      <section className="panel">
        <h2>Import history</h2>
        {!imports?.records.length ? (
          <p className="muted">No imported messages yet.</p>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Data quality</th>
                    <th>Review</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.records.map((record) => (
                    <tr key={record.id}>
                      <td>{record.subject}</td>
                      <td>{record.importStatus}</td>
                      <td>{record.errorCode ?? record.warnings.join(", ")}</td>
                      <td>
                        <Link href={`/review?sourceMessageId=${record.id}`}>
                          Add missed recommendation
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row">
              <button
                className="secondary"
                disabled={busy || imports.page === 1}
                onClick={() => run(() => refresh(imports.page - 1))}
              >
                Previous imports
              </button>
              <span>{imports.total} total</span>
              <button
                className="secondary"
                disabled={busy || imports.page * 50 >= imports.total}
                onClick={() => run(() => refresh(imports.page + 1))}
              >
                Next imports
              </button>
            </div>
          </>
        )}
      </section>
    </>
  );
}
