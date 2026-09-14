"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api, errorText } from "./api-client";
import {
  fieldsSchema,
  lifecycle,
  type RecommendationFields,
} from "@/modules/parsing/contracts";
import {
  recommendationListSchema,
  recommendationViewSchema,
  type RecommendationView,
} from "@/modules/recommendations/views";

const emptyFields: RecommendationFields = {
  provider: "Axis Direct",
  category: null,
  reportReference: null,
  publishedAt: null,
  companyName: null,
  symbol: null,
  bseCode: null,
  action: null,
  recommendedPrice: null,
  entryLow: null,
  entryHigh: null,
  targets: [],
  stopLoss: null,
  statedUpsidePercent: null,
  horizon: null,
  rationale: null,
  status: "NEW",
};
const labels: Record<keyof RecommendationFields, string> = {
  provider: "Research provider",
  category: "Category / report name",
  reportReference: "Report reference",
  publishedAt: "Publication time (ISO with timezone)",
  companyName: "Company name",
  symbol: "NSE symbol (unverified)",
  bseCode: "BSE code (unverified)",
  action: "Action",
  recommendedPrice: "Recommended price / CMP",
  entryLow: "Entry lower bound",
  entryHigh: "Entry upper bound",
  targets: "Targets (comma-separated)",
  stopLoss: "Stop-loss",
  statedUpsidePercent: "Stated upside %",
  horizon: "Holding horizon",
  rationale: "Rationale (limited excerpt)",
  status: "Lifecycle event",
};
const numericFields = new Set([
  "recommendedPrice",
  "entryLow",
  "entryHigh",
  "stopLoss",
  "statedUpsidePercent",
]);

function FieldEditor({
  initial,
  onSave,
  busy,
}: {
  initial: RecommendationFields;
  onSave: (
    fields: RecommendationFields,
    reason: string,
    relationship: string | null,
  ) => Promise<void>;
  busy: boolean;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(initial).map(([key, value]) => [
        key,
        Array.isArray(value)
          ? value.join(", ")
          : value === null
            ? ""
            : String(value),
      ]),
    ),
  );
  const [reason, setReason] = useState("");
  const [relationship, setRelationship] = useState("");
  const [error, setError] = useState("");
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const fields = fieldsSchema.parse(
        Object.fromEntries(
          Object.entries(values).map(([key, value]) => [
            key,
            key === "targets"
              ? value.trim()
                ? value.split(",").map((price) => Number(price.trim()))
                : []
              : numericFields.has(key)
                ? value.trim()
                  ? Number(value)
                  : null
                : value.trim() || null,
          ]),
        ),
      );
      await onSave(fields, reason, relationship.trim() || null);
    } catch (error) {
      setError(errorText(error));
    }
  }
  return (
    <form onSubmit={save}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="grid">
        {(Object.keys(initial) as (keyof RecommendationFields)[]).map((key) => (
          <label key={key}>
            {labels[key]}
            {key === "status" || key === "action" ? (
              <select
                value={values[key]}
                onChange={(event) =>
                  setValues({ ...values, [key]: event.target.value })
                }
              >
                {key === "action" && <option value="">Unknown</option>}
                {(key === "status"
                  ? lifecycle.options
                  : ["BUY", "HOLD", "SELL", "ACCUMULATE", "REDUCE"]
                ).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            ) : (
              <input
                value={values[key]}
                type={numericFields.has(key) ? "number" : "text"}
                step="any"
                onChange={(event) =>
                  setValues({ ...values, [key]: event.target.value })
                }
              />
            )}
          </label>
        ))}
      </div>
      <label>
        Earlier recommendation ID (optional; changes the event relationship)
        <input
          value={relationship}
          onChange={(event) => setRelationship(event.target.value)}
        />
      </label>
      <label>
        Correction reason
        <input
          required
          minLength={3}
          maxLength={200}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </label>
      <button disabled={busy}>Save correction for review</button>
    </form>
  );
}

function ReviewDetail({
  record,
  onUpdate,
}: {
  record: RecommendationView;
  onUpdate: (record: RecommendationView) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  async function mutate(suffix: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      onUpdate(
        await api(
          `recommendations/${record.id}${suffix}`,
          recommendationViewSchema,
          method,
          body,
        ),
      );
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  const source = record.source;
  return (
    <section className="panel">
      <div className="row">
        <h2>
          {record.fields.companyName ??
            record.fields.symbol ??
            "Unidentified recommendation"}
        </h2>
        <span className="badge">{record.reviewStatus}</span>
        <span className="badge">
          {Math.round(record.confidence * 100)}% extraction confidence
        </span>
      </div>
      <p>
        <code>{record.id}</code> · Revision {record.revision} ·{" "}
        {record.parserVersion}
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <p>
        <strong>Source:</strong> {source.subject} · {source.fromAddress} ·
        Received {source.receivedAt}
      </p>
      <p>
        <a
          target="_blank"
          rel="noreferrer"
          href={`https://mail.google.com/mail/u/?authuser=${encodeURIComponent(source.accountEmail)}#all/${source.gmailMessageId}`}
        >
          Open source email in Gmail
        </a>
      </p>
      <p>
        <strong>Available from:</strong> {record.availableAt} (conservative
        Gmail received time)
      </p>
      <details>
        <summary>Source hash and metadata</summary>
        <pre>{JSON.stringify(source, null, 2)}</pre>
      </details>
      {record.warnings.length > 0 && (
        <div className="notice">
          <strong>Data-quality warnings</strong>
          <ul>
            {record.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Field</th>
              <th>Current value</th>
              <th>Manual protection</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(record.fields).map(([key, value]) => (
              <tr key={key}>
                <td>{labels[key as keyof RecommendationFields]}</td>
                <td>
                  {value === null || (Array.isArray(value) && !value.length)
                    ? "Missing"
                    : Array.isArray(value)
                      ? value.join(", ")
                      : value}
                </td>
                <td>
                  {record.manualFields.includes(key)
                    ? "Manually corrected"
                    : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <details>
        <summary>Field evidence and extraction methods</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Extracted value</th>
                <th>Evidence snippet</th>
                <th>Confidence / method</th>
              </tr>
            </thead>
            <tbody>
              {record.evidence.map((evidence) => (
                <tr key={evidence.id}>
                  <td>{evidence.fieldName}</td>
                  <td>{evidence.extractedValue}</td>
                  <td>{evidence.evidenceSnippet}</td>
                  <td>
                    {Math.round(evidence.confidence * 100)}% ·{" "}
                    {evidence.extractionMethod}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <details>
        <summary>Correct extracted fields</summary>
        <FieldEditor
          key={record.revision}
          initial={record.fields}
          busy={busy}
          onSave={(fields, reason, relationship) =>
            mutate("", "PATCH", {
              revision: record.revision,
              fields,
              reason,
              ...(relationship
                ? { relatedRecommendationId: relationship }
                : {}),
            })
          }
        />
      </details>
      <details>
        <summary>Lifecycle events and proposed matches</summary>
        {record.events.map((event) => (
          <div key={event.id}>
            <p>
              {event.eventType} · effective {event.effectiveAt} ·{" "}
              {event.reviewStatus}
            </p>
            <p>
              Earlier record:{" "}
              {event.relatedRecommendationId ?? "No unambiguous match"} · Match
              confidence {Math.round(event.matchConfidence * 100)}%
            </p>
            <pre>{event.newValuesJson}</pre>
          </div>
        ))}
        <p className="muted">
          Updates are separate events at their received timestamp. Earlier
          recommendations are never rewritten.
        </p>
      </details>
      <details>
        <summary>Version history ({record.versions.length})</summary>
        {record.versions.map((version) => (
          <details key={version.revision}>
            <summary>
              Revision {version.revision} · {version.reason} ·{" "}
              {version.createdAt}
            </summary>
            <pre>{version.snapshotJson}</pre>
          </details>
        ))}
      </details>
      <label>
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        I reviewed the evidence, missing fields, and lifecycle relationship.
      </label>
      <div className="row">
        <button
          disabled={busy || !acknowledged}
          onClick={() =>
            mutate("/approve", "POST", {
              revision: record.revision,
              acknowledgeWarnings: acknowledged,
            })
          }
        >
          Approve
        </button>
        <button
          className="danger"
          disabled={busy}
          onClick={() =>
            mutate("/reject", "POST", {
              revision: record.revision,
              acknowledgeWarnings: false,
            })
          }
        >
          Reject
        </button>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => mutate("/reparse", "POST")}
        >
          Reparse from Gmail
        </button>
      </div>
    </section>
  );
}

export function Review({ listing = false }: { listing?: boolean }) {
  const [records, setRecords] = useState<RecommendationView[]>([]);
  const [selected, setSelected] = useState<RecommendationView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState({
    search: "",
    reviewStatus: listing ? "" : "NEEDS_REVIEW",
    status: "",
    category: "",
    symbol: "",
    after: "",
    before: "",
    minConfidence: "",
  });
  const [sourceMessageId, setSourceMessageId] = useState("");
  async function load(nextPage = 1, activeFilters = filters) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams(
        Object.entries(activeFilters).filter(([, value]) => value),
      );
      query.set("page", String(nextPage));
      const result = await api(
        `recommendations?${query}`,
        recommendationListSchema,
      );
      setRecords(result.records);
      setTotal(result.total);
      setPage(result.page);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    const initial = {
      search: "",
      reviewStatus: listing ? "" : "NEEDS_REVIEW",
      status: "",
      category: "",
      symbol: "",
      after: "",
      before: "",
      minConfidence: "",
    };
    const query = new URLSearchParams(
      Object.entries(initial).filter(([, value]) => value),
    );
    api(`recommendations?${query}`, recommendationListSchema)
      .then((result) => {
        setRecords(result.records);
        setTotal(result.total);
        setSourceMessageId(
          new URLSearchParams(window.location.search).get("sourceMessageId") ??
            "",
        );
      })
      .catch((error) => setError(errorText(error)));
  }, [listing]);
  function updated(record: RecommendationView) {
    setSelected(record);
    void load(page);
  }
  async function create(fields: RecommendationFields, reason: string) {
    setLoading(true);
    try {
      const record = await api(
        "recommendations",
        recommendationViewSchema,
        "POST",
        { sourceMessageId, fields, reason },
      );
      setSourceMessageId("");
      updated(record);
    } finally {
      setLoading(false);
    }
  }
  return (
    <>
      <p className="eyebrow">HUMAN-VALIDATED RESEARCH</p>
      <h1>{listing ? "Recommendations" : "Review queue"}</h1>
      <p className="lead">
        Evidence first. Missing values stay missing until you supply a
        correction.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {sourceMessageId && (
        <section className="panel">
          <h2>Add a missed recommendation</h2>
          <p>
            Source message: <code>{sourceMessageId}</code>. Read the source in
            Gmail before entering values.
          </p>
          <FieldEditor initial={emptyFields} busy={loading} onSave={create} />
        </section>
      )}
      <section className="panel">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void load();
          }}
        >
          <div className="row">
            <label>
              Search
              <input
                value={filters.search}
                onChange={(event) =>
                  setFilters({ ...filters, search: event.target.value })
                }
              />
            </label>
            <label>
              Review status
              <select
                value={filters.reviewStatus}
                onChange={(event) =>
                  setFilters({ ...filters, reviewStatus: event.target.value })
                }
              >
                <option value="">All</option>
                <option>NEEDS_REVIEW</option>
                <option>APPROVED</option>
                <option>REJECTED</option>
              </select>
            </label>
            <label>
              Lifecycle
              <select
                value={filters.status}
                onChange={(event) =>
                  setFilters({ ...filters, status: event.target.value })
                }
              >
                <option value="">All</option>
                {lifecycle.options.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
          </div>
          <details>
            <summary>Date, category, symbol, and confidence filters</summary>
            <div className="grid">
              {(
                [
                  "category",
                  "symbol",
                  "after",
                  "before",
                  "minConfidence",
                ] as const
              ).map((key) => (
                <label key={key}>
                  {key === "minConfidence" ? "Minimum confidence (0–1)" : key}
                  <input
                    type={
                      key === "after" || key === "before"
                        ? "date"
                        : key === "minConfidence"
                          ? "number"
                          : "text"
                    }
                    step="0.05"
                    min="0"
                    max="1"
                    value={filters[key]}
                    onChange={(event) =>
                      setFilters({ ...filters, [key]: event.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          </details>
          <button disabled={loading}>Apply filters</button>
        </form>
        <p>
          {total} recommendations {loading && "· Loading…"}
        </p>
        {records.length === 0 ? (
          <p className="muted">
            No recommendations match.{" "}
            <Link href="/inbox">Import selected research emails</Link> to get
            started.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Received</th>
                  <th>Company / symbol</th>
                  <th>Category</th>
                  <th>Lifecycle</th>
                  <th>Review</th>
                  <th>Confidence</th>
                  <th>Open</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => (
                  <tr key={record.id}>
                    <td>{record.availableAt.slice(0, 10)}</td>
                    <td>
                      {record.fields.companyName}
                      <br />
                      {record.fields.symbol ?? "Symbol missing"}
                    </td>
                    <td>{record.fields.category ?? "Missing"}</td>
                    <td>{record.fields.status}</td>
                    <td>{record.reviewStatus}</td>
                    <td>{Math.round(record.confidence * 100)}%</td>
                    <td>
                      <button
                        className="secondary"
                        onClick={() => setSelected(record)}
                      >
                        Review
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row">
          <button
            className="secondary"
            disabled={loading || page === 1}
            onClick={() => load(page - 1)}
          >
            Previous
          </button>
          <span>Page {page}</span>
          <button
            className="secondary"
            disabled={loading || page * 50 >= total}
            onClick={() => load(page + 1)}
          >
            Next
          </button>
        </div>
      </section>
      {selected && (
        <ReviewDetail key={selected.id} record={selected} onUpdate={updated} />
      )}
    </>
  );
}
