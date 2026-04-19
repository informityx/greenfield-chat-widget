"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { IconArrowLeftOnRectangle, IconKey } from "@/app/admin/icons";

const inputClass =
  "h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition-colors duration-200 motion-reduce:transition-none placeholder:text-slate-400 focus-visible:border-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/35 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus-visible:border-blue-400";

export default function AdminLoginPage() {
  const router = useRouter();
  const usernameId = useId();
  const passwordId = useId();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Sign in failed (${res.status})`);
        return;
      }
      router.push("/admin");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col items-center px-2 sm:px-0">
      <div className="w-full rounded-2xl border border-slate-200/90 bg-white p-6 shadow-lg shadow-slate-900/5 dark:border-slate-700/90 dark:bg-slate-900 dark:shadow-black/30 sm:p-8">
        <div className="mb-6 flex items-start gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-700 text-white dark:bg-blue-600">
            <IconKey className="h-6 w-6" aria-hidden />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white">
              Admin sign in
            </h1>
            <p className="mt-1 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
              Use{" "}
              <code className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-800 [font-family:var(--font-admin-mono),ui-monospace] dark:bg-slate-800 dark:text-slate-200">
                ADMIN_DASHBOARD_USER
              </code>{" "}
              and{" "}
              <code className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-800 [font-family:var(--font-admin-mono),ui-monospace] dark:bg-slate-800 dark:text-slate-200">
                ADMIN_DASHBOARD_PASSWORD
              </code>{" "}
              from your server environment.
            </p>
          </div>
        </div>

        <form className="flex flex-col gap-5" onSubmit={onSubmit} noValidate>
          <div>
            <label
              htmlFor={usernameId}
              className="block text-sm font-medium text-slate-800 dark:text-slate-200"
            >
              Username
            </label>
            <input
              id={usernameId}
              className={`${inputClass} mt-1.5`}
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div>
            <label
              htmlFor={passwordId}
              className="block text-sm font-medium text-slate-800 dark:text-slate-200"
            >
              Password
            </label>
            <input
              id={passwordId}
              type="password"
              className={`${inputClass} mt-1.5`}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error ? (
            <p
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900/60 dark:bg-red-950/50 dark:text-red-200"
              role="alert"
              aria-live="assertive"
            >
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white shadow-sm transition-colors duration-200 motion-reduce:transition-none hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:pointer-events-none disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:ring-offset-slate-900"
          >
            <IconArrowLeftOnRectangle className="h-5 w-5" aria-hidden />
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
