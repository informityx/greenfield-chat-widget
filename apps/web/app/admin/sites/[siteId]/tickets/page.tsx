"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { IconInbox, IconLayoutGrid } from "@/app/admin/icons";

const mono = "[font-family:var(--font-admin-mono),ui-monospace]";

type TicketRow = {
  id: string;
  sessionId: string | null;
  email: string | null;
  fullName: string | null;
  status: string;
  type: string;
  priority: string;
  summary: string | null;
  createdAt: string;
};

export default function SiteTicketsPage() {
  const params = useParams();
  const router = useRouter();
  const siteId = typeof params.siteId === "string" ? params.siteId : "";
  const [authChecked, setAuthChecked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);

  const load = useCallback(async () => {
    if (!siteId) return;
    const res = await fetch(
      `/api/admin/sites/${encodeURIComponent(siteId)}/tickets`,
      { credentials: "include" },
    );
    if (res.status === 401) {
      router.push("/admin/login");
      return;
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? `Failed to load (${res.status})`);
      return;
    }
    const data = (await res.json()) as { tickets: TicketRow[] };
    setTickets(data.tickets);
    setError(null);
  }, [router, siteId]);

  useEffect(() => {
    (async () => {
      const me = await fetch("/api/admin/me", { credentials: "include" });
      if (me.status === 401) {
        router.push("/admin/login");
        return;
      }
      setAuthChecked(true);
      await load();
    })();
  }, [load, router]);

  if (!authChecked) {
    return (
      <p className="text-sm text-slate-600 dark:text-slate-400" role="status">
        Loading…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            href="/admin"
            className="text-sm font-medium text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
          >
            ← Back to sites
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            <IconInbox className="h-7 w-7 text-blue-700 dark:text-blue-400" aria-hidden />
            Tickets
          </h1>
          <p className={`mt-1 text-sm text-slate-600 dark:text-slate-400 ${mono}`}>
            site_id: {siteId}
          </p>
        </div>
        <Link
          href="/admin"
          className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition-colors hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
        >
          <IconLayoutGrid className="h-5 w-5" aria-hidden />
          Dashboard
        </Link>
      </div>

      {error ? (
        <p
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm dark:border-slate-700/90 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">Support tickets for this site</caption>
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50/90 dark:border-slate-800 dark:bg-slate-950/80">
                <th
                  scope="col"
                  className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400"
                >
                  Created
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400"
                >
                  Status
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400"
                >
                  Type / priority
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400"
                >
                  Contact
                </th>
                <th
                  scope="col"
                  className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400"
                >
                  Summary
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="px-4 py-10 text-center text-slate-600 dark:text-slate-400"
                  >
                    No tickets for this site yet.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-slate-600 dark:text-slate-400">
                      {new Date(t.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-slate-900 dark:text-slate-100">{t.status}</td>
                    <td className="px-4 py-2 text-slate-700 dark:text-slate-300">
                      {t.type} · {t.priority}
                    </td>
                    <td className="max-w-[200px] px-4 py-2 text-slate-700 dark:text-slate-300">
                      <div className="truncate">{t.fullName ?? "—"}</div>
                      <div className={`truncate text-xs ${mono}`}>{t.email ?? "—"}</div>
                    </td>
                    <td className="max-w-md px-4 py-2 text-slate-700 dark:text-slate-300">
                      {t.summary ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
