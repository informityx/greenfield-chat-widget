"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  IconArrowRightOnRectangle,
  IconClipboard,
  IconCodeBracket,
  IconInbox,
  IconKey,
  IconLayoutGrid,
  IconPlay,
  IconPlusCircle,
  IconTable,
} from "@/app/admin/icons";

const mono = "[font-family:var(--font-admin-mono),ui-monospace]";

const inputClass =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors duration-200 motion-reduce:transition-none placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/35 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-blue-400";

const textareaClass =
  "min-h-[128px] w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors duration-200 motion-reduce:transition-none placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/35 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-blue-400";

const cardClass =
  "rounded-2xl border border-slate-200/90 bg-white shadow-sm shadow-slate-900/5 dark:border-slate-700/90 dark:bg-slate-900 dark:shadow-black/20";

const ACTION_MESSAGE_SUCCESS_MS = 60_000;
const ACTION_MESSAGE_ERROR_MS = 10_000;

/** 16 bytes → 32 hex chars, prefixed with `site_` (embed-friendly tenant slug). */
function generatePrefixedSiteId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `site_${hex}`;
}

function tryAbsoluteSiteUrl(raw: string): URL | null {
  const t = raw.trim();
  if (!t) return null;
  try {
    return new URL(t);
  } catch {
    try {
      return new URL(`https://${t}`);
    } catch {
      return null;
    }
  }
}

type SiteRow = {
  siteId: string;
  allowedOrigins: unknown;
  createdAt: string;
  updatedAt: string;
};

type RegisterOk = {
  ok: true;
  siteId: string;
  publishableKey: string;
  allowedOrigins: string[];
  ingest: { jobId: string; documentId: string; chunkCount: number } | null;
};

export default function AdminDashboardPage() {
  const router = useRouter();
  const siteIdField = useId();
  const siteUrlField = useId();
  const documentUrlField = useId();
  const pastedTextField = useId();

  const [authChecked, setAuthChecked] = useState(false);
  const [sites, setSites] = useState<SiteRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [siteId, setSiteId] = useState("");
  const [siteIdUserEdited, setSiteIdUserEdited] = useState(false);
  const [siteUrl, setSiteUrl] = useState("");
  const [documentUrl, setDocumentUrl] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [lastCreated, setLastCreated] = useState<RegisterOk | null>(null);
  const [ingestLog, setIngestLog] = useState<string[]>([]);
  const [ingestRunning, setIngestRunning] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const actionMessageClearTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** While set, embed-snippet API is in flight for this site_id (Generate script). */
  const [generatingScriptSiteId, setGeneratingScriptSiteId] = useState<string | null>(
    null,
  );
  /** While set, rotate-publishable-key API is in flight for this site_id. */
  const [rotatingKeySiteId, setRotatingKeySiteId] = useState<string | null>(null);

  const siteRowActionsBusy =
    generatingScriptSiteId !== null || rotatingKeySiteId !== null;

  const refreshSites = useCallback(async () => {
    const res = await fetch("/api/admin/sites", { credentials: "include" });
    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }
    if (!res.ok) {
      setLoadError(`Failed to load sites (${res.status})`);
      return;
    }
    const data = (await res.json()) as { sites: SiteRow[] };
    setSites(data.sites);
    setLoadError(null);
  }, [router]);

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/admin/me", { credentials: "include" });
      if (me.status === 401) {
        router.push("/admin/login");
        return;
      }
      setAuthChecked(true);
      await refreshSites();
    })();
  }, [router, refreshSites]);

  useEffect(() => {
    if (siteIdUserEdited) return;
    const handle = window.setTimeout(() => {
      const parsed = tryAbsoluteSiteUrl(siteUrl);
      if (!parsed) {
        if (!siteUrl.trim()) setSiteId("");
        return;
      }
      setSiteId(generatePrefixedSiteId());
    }, 450);
    return () => window.clearTimeout(handle);
  }, [siteUrl, siteIdUserEdited]);

  useEffect(() => {
    return () => {
      if (actionMessageClearTimeoutRef.current !== null) {
        clearTimeout(actionMessageClearTimeoutRef.current);
      }
    };
  }, []);

  function flashActionMessage(msg: string, durationMs = ACTION_MESSAGE_SUCCESS_MS) {
    setActionMessage(msg);
    if (actionMessageClearTimeoutRef.current !== null) {
      clearTimeout(actionMessageClearTimeoutRef.current);
    }
    actionMessageClearTimeoutRef.current = setTimeout(() => {
      setActionMessage(null);
      actionMessageClearTimeoutRef.current = null;
    }, durationMs);
  }

  async function rotatePublishableKeyForSite(sid: string) {
    const ok = window.confirm(
      "Generate a new publishable key? Existing embeds using the old key will stop working until you update them. The new key is stored encrypted for one-click copy.",
    );
    if (!ok) return;
    setRotatingKeySiteId(sid);
    try {
      const res = await fetch(
        `/api/admin/sites/${encodeURIComponent(sid)}/rotate-publishable-key`,
        { method: "POST", credentials: "include" },
      );
      const data = (await res.json().catch(() => ({}))) as {
        publishableKey?: string;
        error?: string;
      };
      if (!res.ok) {
        flashActionMessage(
          data.error ?? `Rotate failed (${res.status}).`,
          ACTION_MESSAGE_ERROR_MS,
        );
        return;
      }
      flashActionMessage(
        `New key issued for ${sid}. It is shown once here — copy it now: ${data.publishableKey ?? "(missing)"}`,
      );
    } finally {
      setRotatingKeySiteId(null);
    }
  }

  async function generateEmbedScriptForSite(sid: string) {
    setGeneratingScriptSiteId(sid);
    try {
      const res = await fetch(
        `/api/admin/sites/${encodeURIComponent(sid)}/embed-snippet`,
        {
          credentials: "include",
          headers: { "x-embed-origin": window.location.origin },
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        snippet?: string;
        keyMode?: string;
        error?: string;
      };
      if (!res.ok) {
        flashActionMessage(
          typeof data.error === "string"
            ? data.error
            : `Could not load embed snippet (${res.status}).`,
          ACTION_MESSAGE_ERROR_MS,
        );
        return;
      }
      if (!data.snippet) {
        flashActionMessage("No snippet returned.", ACTION_MESSAGE_ERROR_MS);
        return;
      }
      try {
        await navigator.clipboard.writeText(data.snippet);
        if (data.keyMode === "demo_env") {
          flashActionMessage(
            "Embed script copied (demo key from ADMIN_DEMO_PUBLISHABLE_KEY / SEED_DEMO_PUBLISHABLE_KEY).",
          );
        } else {
          flashActionMessage("Embed script copied to clipboard.");
        }
      } catch {
        flashActionMessage("Clipboard unavailable. Showing the snippet in an alert.");
        window.alert(data.snippet);
      }
    } finally {
      setGeneratingScriptSiteId(null);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", {
      method: "POST",
      credentials: "include",
    });
    router.push("/admin/login");
    router.refresh();
  }

  async function onRegister(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setLastCreated(null);
    setIngestLog([]);
    setSubmitting(true);
    try {
      const normalizedUrl = tryAbsoluteSiteUrl(siteUrl);
      if (!normalizedUrl) {
        setSubmitError(
          "Enter a valid customer site URL (e.g. https://www.example.com).",
        );
        return;
      }
      const body: Record<string, string> = {
        siteId: siteId.trim(),
        siteUrl: normalizedUrl.href,
      };
      const du = documentUrl.trim();
      const pt = pastedText.trim();
      if (du) body.documentUrl = du;
      if (pt) body.pastedText = pt;
      if (!du && !pt) {
        setSubmitError("Provide a document URL and/or pasted text for RAG.");
        return;
      }
      const res = await fetch("/api/admin/sites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSubmitError(
          typeof data.error === "string" ? data.error : `Error (${res.status})`,
        );
        return;
      }
      if (data.ok) {
        const created = data as RegisterOk;
        setLastCreated(created);
        setSiteId("");
        setSiteIdUserEdited(false);
        setSiteUrl("");
        setDocumentUrl("");
        setPastedText("");
        await refreshSites();
        try {
          await navigator.clipboard.writeText(created.publishableKey);
          flashActionMessage(
            "Publishable key copied to clipboard. It is also in the yellow card below — the server stores it encrypted (ADMIN_SECRET) so **Generate script** works later.",
          );
        } catch {
          flashActionMessage(
            "Site created. Copy the **publishable key** from the yellow card below (clipboard blocked). Generate script will work while ADMIN_SECRET is set.",
          );
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function runIngestUntilDone() {
    setIngestRunning(true);
    setIngestLog([]);
    try {
      for (let i = 0; i < 500; i++) {
        const res = await fetch("/api/admin/ingest/run-once", {
          method: "POST",
          credentials: "include",
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          error?: string;
          processed?: number;
          remaining?: number;
          done?: boolean;
          message?: string;
          idle?: boolean;
        };
        if (!res.ok) {
          setIngestLog((l) => [...l, `Error: ${data.error ?? res.status}`]);
          break;
        }
        if (data.idle) {
          setIngestLog((l) => [...l, data.message ?? "No pending ingest jobs."]);
          break;
        }
        if (typeof data.processed === "number") {
          setIngestLog((l) => [
            ...l,
            `Processed ${data.processed}, remaining ${data.remaining ?? "?"}, done=${String(data.done)}`,
          ]);
        }
        if (data.done === true) {
          break;
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    } finally {
      setIngestRunning(false);
    }
  }

  if (!authChecked) {
    return (
      <div
        className="flex items-center gap-3 text-sm text-slate-600 dark:text-slate-400"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span
          className="inline-flex h-2.5 w-2.5 rounded-full bg-blue-600 motion-safe:animate-pulse motion-reduce:opacity-70"
          aria-hidden
        />
        Loading dashboard…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-blue-800 dark:text-blue-300">
            Tenants
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            <IconLayoutGrid className="h-7 w-7 text-blue-700 dark:text-blue-400" aria-hidden />
            Sites
          </h1>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
            Manage embed tenants, CORS origins, and queued knowledge ingest for the
            chat widget.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-medium text-slate-800 shadow-sm transition-colors duration-200 motion-reduce:transition-none hover:border-slate-300 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:ring-offset-2 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950"
        >
          <IconArrowRightOnRectangle className="h-5 w-5 text-slate-500 dark:text-slate-400" />
          Sign out
        </button>
      </div>

      {loadError ? (
        <p
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {loadError}
        </p>
      ) : null}

      {actionMessage ? (
        <p
          className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-100"
          role="status"
          aria-live="polite"
        >
          {actionMessage}
        </p>
      ) : null}

      <section className={`${cardClass} p-5 sm:p-6`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-800 text-white dark:bg-slate-700">
            <IconPlay className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Background ingest
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Scheduled ingest calls <code className={mono}>GET /api/internal/ingest/step</code>{" "}
              (Vercel cron:<span className={mono}> 06:00 UTC daily</span> in{" "}
              <code className={mono}>vercel.json</code>
              ). On Hobby that is the automatic run; use the button below anytime to process pending
              embeddings and <code className={mono}>document_chunks</code> without waiting.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                disabled={ingestRunning}
                className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-slate-800 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/40 disabled:pointer-events-none disabled:opacity-50 dark:bg-slate-600 dark:hover:bg-slate-500"
                onClick={() => void runIngestUntilDone()}
              >
                {ingestRunning ? (
                  <>
                    <span
                      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-transparent motion-reduce:animate-none"
                      aria-hidden
                    />
                    Running batches…
                  </>
                ) : (
                  <>
                    <IconPlay className="h-5 w-5" aria-hidden />
                    Run ingest now (batches until idle)
                  </>
                )}
              </button>
            </div>
            {ingestLog.length > 0 ? (
              <pre
                className={`mt-4 max-h-52 overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-800 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 ${mono}`}
                tabIndex={0}
              >
                {ingestLog.join("\n")}
              </pre>
            ) : null}
          </div>
        </div>
      </section>

      <section className={`${cardClass} overflow-hidden`}>
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-5">
          <IconTable className="h-5 w-5 text-slate-500 dark:text-slate-400" aria-hidden />
          <h2 className="text-sm font-semibold text-slate-900 dark:text-white">
            Registered sites
          </h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <caption className="sr-only">
              Widget sites, allowed origins, and row actions
            </caption>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/90 dark:border-slate-800 dark:bg-slate-950/80">
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 sm:px-5"
                >
                  site_id
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 sm:px-5"
                >
                  Allowed origins
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 sm:px-5"
                >
                  Created
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400 sm:px-5"
                >
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sites.length === 0 ? (
                <tr>
                  <td
                    colSpan={4}
                    className="px-4 py-10 text-center text-slate-600 dark:text-slate-400 sm:px-5"
                  >
                    No sites yet. Register one in the form below.
                  </td>
                </tr>
              ) : (
                sites.map((s) => (
                  <tr
                    key={s.siteId}
                    className="border-b border-slate-100 transition-colors duration-150 last:border-0 motion-reduce:transition-none hover:bg-slate-50/80 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    <td
                      className={`px-4 py-3 text-slate-900 dark:text-slate-100 sm:px-5 ${mono} text-xs font-medium`}
                    >
                      {s.siteId}
                    </td>
                    <td
                      className={`min-w-0 max-w-xl px-4 py-3 text-slate-600 dark:text-slate-300 sm:px-5 ${mono} text-xs align-top`}
                    >
                      {Array.isArray(s.allowedOrigins) ? (
                        <ul className="m-0 list-none space-y-1.5 break-all p-0">
                          {(s.allowedOrigins as string[]).map((origin, i) => (
                            <li key={`${s.siteId}-origin-${i}`}>{origin}</li>
                          ))}
                        </ul>
                      ) : (
                        <span className="break-all">{JSON.stringify(s.allowedOrigins)}</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-slate-600 dark:text-slate-400 sm:px-5">
                      {new Date(s.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right sm:px-5">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          disabled={siteRowActionsBusy}
                          aria-busy={generatingScriptSiteId === s.siteId}
                          onClick={() => void generateEmbedScriptForSite(s.siteId)}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          {generatingScriptSiteId === s.siteId ? (
                            <>
                              <span
                                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent motion-reduce:animate-none dark:border-slate-500 dark:border-t-transparent"
                                aria-hidden
                              />
                              Generating…
                            </>
                          ) : (
                            <>
                              <IconCodeBracket className="h-4 w-4" aria-hidden />
                              Generate script
                            </>
                          )}
                        </button>
                        <Link
                          href={`/admin/sites/${encodeURIComponent(s.siteId)}/tickets`}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                        >
                          <IconInbox className="h-4 w-4" aria-hidden />
                          Tickets
                        </Link>
                        <button
                          type="button"
                          disabled={siteRowActionsBusy}
                          aria-busy={rotatingKeySiteId === s.siteId}
                          onClick={() => void rotatePublishableKeyForSite(s.siteId)}
                          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-amber-200/80 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-950 shadow-sm transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 disabled:pointer-events-none disabled:opacity-50 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-900/50"
                          title="Creates a new key and stores it for Generate script"
                        >
                          {rotatingKeySiteId === s.siteId ? (
                            <>
                              <span
                                className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-amber-700/50 border-t-transparent motion-reduce:animate-none dark:border-amber-200/50 dark:border-t-transparent"
                                aria-hidden
                              />
                              Rotating…
                            </>
                          ) : (
                            <>
                              <IconKey className="h-4 w-4" aria-hidden />
                              Rotate key
                            </>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className={`${cardClass} p-5 sm:p-6`}>
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white dark:bg-blue-600">
            <IconPlusCircle className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">
              Register new site
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              The customer <strong className="font-medium text-slate-800 dark:text-slate-200">site URL</strong>{" "}
              sets CORS allowed origins only.{" "}
              <strong className="font-medium text-slate-800 dark:text-slate-200">Knowledge</strong> comes from an
              HTTPS document URL and/or pasted plain text (URL wins if both are set).
            </p>
          </div>
        </div>

        <form className="mt-6 flex flex-col gap-5" onSubmit={onRegister}>
          <div>
            <label
              htmlFor={siteUrlField}
              className="block text-sm font-medium text-slate-800 dark:text-slate-200"
            >
              Customer site URL (for CORS)
            </label>
            <p id={`${siteUrlField}-hint`} className="mt-0.5 text-xs text-slate-600 dark:text-slate-500">
              Enter this first. A <span className={mono}>site_</span> id is generated automatically (you can
              override it below).
            </p>
            <input
              id={siteUrlField}
              type="url"
              className={`${inputClass} mt-1.5`}
              placeholder="https://www.customer.com"
              value={siteUrl}
              onChange={(e) => setSiteUrl(e.target.value)}
              aria-describedby={`${siteUrlField}-hint`}
              required
            />
          </div>
          <div>
            <label
              htmlFor={siteIdField}
              className="block text-sm font-medium text-slate-800 dark:text-slate-200"
            >
              Public <span className={mono}>site_id</span>
            </label>
            <p id={`${siteIdField}-hint`} className="mt-0.5 text-xs text-slate-600 dark:text-slate-500">
              Format <span className={mono}>site_</span> + 32 hex characters. Fills when the URL is valid;
              edit to use your own id.
            </p>
            <input
              id={siteIdField}
              className={`${inputClass} mt-1.5 ${mono}`}
              placeholder="site_… (auto)"
              value={siteId}
              onChange={(e) => {
                setSiteIdUserEdited(true);
                setSiteId(e.target.value);
              }}
              aria-describedby={`${siteIdField}-hint`}
              required
            />
          </div>
          <div>
            <label
              htmlFor={documentUrlField}
              className="block text-sm font-medium text-slate-800 dark:text-slate-200"
            >
              Document URL (HTTPS)
            </label>
            <p id={`${documentUrlField}-hint`} className="mt-0.5 text-xs text-slate-600 dark:text-slate-500">
              Optional if you paste text below. Used to fetch PDF, HTML, or plain text.
            </p>
            <input
              id={documentUrlField}
              type="url"
              className={`${inputClass} mt-1.5`}
              placeholder="https://example.com/docs/pricing.pdf"
              value={documentUrl}
              onChange={(e) => setDocumentUrl(e.target.value)}
              aria-describedby={`${documentUrlField}-hint`}
            />
          </div>
          <div>
            <label
              htmlFor={pastedTextField}
              className="block text-sm font-medium text-slate-800 dark:text-slate-200"
            >
              Or paste plain text
            </label>
            <textarea
              id={pastedTextField}
              className={`${textareaClass} mt-1.5`}
              placeholder="Policies, FAQs, product copy…"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
            />
          </div>
          {submitError ? (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200"
              role="alert"
              aria-live="assertive"
            >
              {submitError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex h-11 w-fit cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-700 px-5 text-sm font-semibold text-white shadow-sm transition-colors duration-200 motion-reduce:transition-none hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:ring-offset-slate-900"
          >
            {submitting ? "Creating…" : "Create site & queue RAG"}
          </button>
        </form>
      </section>

      {lastCreated ? (
        <section
          className="rounded-2xl border border-amber-200/90 bg-gradient-to-br from-amber-50 to-white p-5 shadow-md shadow-amber-900/5 dark:border-amber-900/40 dark:from-amber-950/50 dark:to-slate-900 sm:p-6"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-slate-900">
              <IconKey className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900 dark:text-amber-100">
                Save these embed credentials
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-amber-100/85">
                <strong className="font-semibold text-slate-900 dark:text-amber-50">
                  The publishable key is only shown in this dashboard here.
                </strong>{" "}
                It was just copied to your clipboard if the browser allowed it. The server
                also saves it <strong className="font-semibold">encrypted</strong> (using{" "}
                <code className={mono}>ADMIN_SECRET</code>) so you can use{" "}
                <strong className="font-semibold">Generate script</strong> in the table anytime
                without seeing the key again.
              </p>
            </div>
          </div>

          <dl className="mt-5 space-y-4 text-sm">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-amber-200/80">
                site_id
              </dt>
              <dd className={`mt-1 break-all text-base font-medium text-slate-900 dark:text-white ${mono}`}>
                {lastCreated.siteId}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-amber-200/80">
                publishable_key
              </dt>
              <dd className={`mt-1 break-all text-sm text-slate-900 dark:text-amber-50 ${mono}`}>
                {lastCreated.publishableKey}
              </dd>
            </div>
            {lastCreated.ingest ? (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-amber-200/80">
                  Ingest queued
                </dt>
                <dd className={`mt-1 text-xs text-slate-700 dark:text-amber-100/90 ${mono}`}>
                  {lastCreated.ingest.chunkCount} chunks · job {lastCreated.ingest.jobId}
                </dd>
              </div>
            ) : null}
          </dl>

          <div className="mt-5 flex flex-wrap gap-3">
            <button
              type="button"
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-semibold text-slate-900 shadow-sm transition-colors duration-200 motion-reduce:transition-none hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/80 focus-visible:ring-offset-2 focus-visible:ring-offset-amber-50 dark:focus-visible:ring-offset-slate-900"
              onClick={() => {
                void navigator.clipboard.writeText(lastCreated.publishableKey);
              }}
            >
              <IconClipboard className="h-5 w-5" aria-hidden />
              Copy publishable key
            </button>
            <button
              type="button"
              disabled={siteRowActionsBusy}
              aria-busy={
                generatingScriptSiteId === lastCreated.siteId ||
                rotatingKeySiteId === lastCreated.siteId
              }
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500/50 disabled:pointer-events-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
              onClick={() => void generateEmbedScriptForSite(lastCreated.siteId)}
            >
              {generatingScriptSiteId === lastCreated.siteId ? (
                <>
                  <span
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-transparent motion-reduce:animate-none"
                    aria-hidden
                  />
                  Generating…
                </>
              ) : rotatingKeySiteId === lastCreated.siteId ? (
                <>
                  <span
                    className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/50 border-t-transparent motion-reduce:animate-none"
                    aria-hidden
                  />
                  Rotating…
                </>
              ) : (
                <>
                  <IconCodeBracket className="h-5 w-5" aria-hidden />
                  Generate script
                </>
              )}
            </button>
            <button
              type="button"
              disabled={ingestRunning || !lastCreated.ingest}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-blue-800 bg-white px-4 text-sm font-semibold text-blue-900 transition-colors duration-200 motion-reduce:transition-none hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/45 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 dark:border-blue-500 dark:bg-slate-900 dark:text-blue-100 dark:hover:bg-slate-800 dark:focus-visible:ring-offset-slate-950"
              onClick={() => void runIngestUntilDone()}
            >
              <IconPlay className="h-5 w-5" aria-hidden />
              {ingestRunning ? "Embedding…" : "Run ingest (batches)"}
            </button>
          </div>
          <p className="mt-3 text-xs leading-relaxed text-slate-600 dark:text-amber-200/70">
            Progress logs appear in the <strong className="font-medium">Background ingest</strong> section
            above.
          </p>
        </section>
      ) : null}
    </div>
  );
}
