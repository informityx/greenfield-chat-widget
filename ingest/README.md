# Ingest (optional Python)

This directory is a **placeholder** for a future **Python** ingest CLI or worker (for example heavier PDF tooling). It is **not** wired into the app today.

## Where ingest actually runs

Production ingest is implemented in **TypeScript** inside the Next.js app (`apps/web`):

| Area | Role |
|------|------|
| [`apps/web/lib/ingest/fetch-document.ts`](../apps/web/lib/ingest/fetch-document.ts) | Fetch HTTPS documents with SSRF guards and size limits; extract text (HTML / plain text / PDF). |
| [`apps/web/lib/ingest/queue-ingest.ts`](../apps/web/lib/ingest/queue-ingest.ts) | Chunk text, write `ingest_jobs` + pending work for embeddings. |
| [`apps/web/lib/ingest/process-ingest-batch.ts`](../apps/web/lib/ingest/process-ingest-batch.ts) | Worker batch: embeddings + `document_chunks` writes. |
| [`apps/web/app/api/internal/ingest/step/route.ts`](../apps/web/app/api/internal/ingest/step/route.ts) | Secured `GET` step endpoint (Bearer or `?secret=` vs `CRON_SECRET` / `INGEST_CRON_SECRET`). |
| [`apps/web/app/api/admin/ingest/run-once/route.ts`](../apps/web/app/api/admin/ingest/run-once/route.ts) | Admin-authenticated single step for local dashboards. |
| [`apps/web/app/api/admin/sites/route.ts`](../apps/web/app/api/admin/sites/route.ts) | Registering a site queues ingest from **document URL** and/or **pasted text**. |

RAG in chat uses embeddings stored per site in Postgres (`document_chunks`). Product background and phased delivery are in [`docs/PROJECT_BOOTSTRAP_SPEC.md`](../docs/PROJECT_BOOTSTRAP_SPEC.md) (see multi-tenancy and ingest sections).

## Python dependencies

[`requirements.txt`](requirements.txt) is intentionally minimal until a Python worker exists. Add libraries here only when you introduce code under this folder.

## Embeddable widget (separate from this folder)

The chat widget and embed script are built from [`packages/widget`](../packages/widget) and served as `widget.js` from the web app. Ingested knowledge is scoped by **`data-site-id`** and authenticated with **`data-publishable-key`** on the script tag; those values come from the admin dashboard after you register a site and complete ingest.

## Product reference (screenshots)

End-to-end flow this repo supports: **admin** → **tenant + ingest** → **embeddable assistant** on customer sites. Images live under [`ingest/reference/`](reference/) so they version with the repo.

### Admin sign in

Gate for `/admin`: credentials from `ADMIN_DASHBOARD_USER` and `ADMIN_DASHBOARD_PASSWORD` in the server environment.

![Admin sign in screen](./reference/admin-sign-in.png)

### Widget admin (sites & ingest)

Dashboard to register sites (CORS origins from customer URL), attach an HTTPS document and/or pasted text for RAG, run ingest, **Generate script**, **Tickets**, and **Rotate key**. Allowed origins are listed in full, one per line.

![Widget admin — registered sites and register form](./reference/widget-admin-dashboard.png)

### Embeddable chat on a customer page

Launcher copy and in-page chat after the embed script is installed; conversation is grounded on ingested content for that `site_id`.

![Embeddable widget — launcher and chat](./reference/embeddable-widget-chat.png)
