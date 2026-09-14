"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { api, errorText, okSchema } from "./api-client";
import { GMAIL_SCOPE } from "@/modules/security/env";

const statusSchema = z.object({
  connected: z.boolean(),
  email: z.string().nullable(),
  scope: z.string(),
  configuration: z.object({
    valid: z.boolean(),
    oauthConfigured: z.boolean(),
    errors: z.array(z.string()),
  }),
});
export function Setup() {
  const [status, setStatus] = useState<z.infer<typeof statusSchema> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  async function refresh() {
    setStatus(await api("auth/status", statusSchema));
  }
  useEffect(() => {
    api("auth/status", statusSchema)
      .then((status) => {
        setStatus(status);
        if (new URLSearchParams(window.location.search).has("error"))
          setError(
            "Google connection failed or was cancelled. Check credentials and reconnect.",
          );
      })
      .catch((error) => setError(errorText(error)));
  }, []);
  async function act(path: string, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      await api(path, okSchema, "POST", body);
      setConfirmation("");
      await refresh();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">PRIVATE WORKSPACE</p>
      <h1>Setup</h1>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="panel">
        <h2>Gmail connection</h2>
        {!status ? (
          <p role="status">Checking configuration…</p>
        ) : (
          <>
            <p>
              <span className="badge">
                {status.connected ? "CONNECTED" : "DISCONNECTED"}
              </span>{" "}
              {status.email}
            </p>
            {status.configuration.errors.map((error) => (
              <p key={error} className="error">
                {error}
              </p>
            ))}
            {!status.configuration.oauthConfigured && (
              <p className="notice">
                Add Google OAuth credentials to your server’s .env file. See
                README for the exact setup steps.
              </p>
            )}
            <p>
              Only requested scope: <code>{GMAIL_SCOPE}</code>
            </p>
            <div className="row">
              {status.configuration.valid &&
                status.configuration.oauthConfigured && (
                  <button
                    onClick={() =>
                      window.location.assign(
                        new URL("/api/auth/google", window.location.origin)
                          .href,
                      )
                    }
                  >
                    {status.connected ? "Reconnect Gmail" : "Connect Gmail"}
                  </button>
                )}
              <button
                className="secondary"
                disabled={busy || !status.connected}
                onClick={() => act("auth/google/disconnect")}
              >
                Disconnect & delete local token
              </button>
            </div>
            <p className="muted">
              Disconnect removes the local token. To revoke Google’s grant,
              remove RecoLab from{" "}
              <a
                href="https://myaccount.google.com/connections"
                target="_blank"
                rel="noreferrer"
              >
                Google account connections
              </a>
              .
            </p>
          </>
        )}
      </section>
      <section className="panel">
        <h2>Data retention</h2>
        <p>
          Email bodies and PDFs are processed in memory and discarded. Saved
          records contain source metadata, a SHA-256 hash, extracted values,
          limited evidence, and correction history. AI extraction is disabled.
        </p>
        <p className="notice">
          Local deletion removes connections, sources, imported records,
          evidence, and audit history. It does not modify Gmail. Backups must be
          deleted separately.
        </p>
        <label>
          Type DELETE LOCAL DATA to confirm
          <input
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </label>
        <button
          className="danger"
          disabled={busy || confirmation !== "DELETE LOCAL DATA"}
          onClick={() => act("settings/delete-data", { confirmation })}
        >
          Delete local data
        </button>
      </section>
    </>
  );
}
