# greenfield-chat-widget

Embeddable **chat widget** and **Next.js** backend for a multi-tenant, **RAG-ready** assistant. Product direction, compliance notes, and phased delivery are defined in [`PROJECT_BOOTSTRAP_SPEC.md`](PROJECT_BOOTSTRAP_SPEC.md) (duplicate: [`docs/PROJECT_BOOTSTRAP_SPEC.md`](docs/PROJECT_BOOTSTRAP_SPEC.md)).

**Stack (current):** npm workspaces monorepo · Next.js App Router (`apps/web`) · Vite IIFE widget (`packages/widget`) · Prisma + PostgreSQL + **pgvector** · OpenAI (streaming chat; embeddings env prepared for RAG).

---

## Repository layout

| Path | Purpose |
|------|---------|
| [`apps/web/`](apps/web/) | Next.js app: UI, `POST /api/chat` (streaming), internal ingest stub, serves `public/widget.js` |
| [`packages/widget/`](packages/widget/) | Vite build → single-file IIFE copied to `apps/web/public/widget.js` |
| [`prisma/`](prisma/) | Schema, migrations (`vector` extension + `sites`, `ingest_jobs`, `document_chunks`) |
| [`ingest/`](ingest/) | Optional future Python ingest (spec §13 prefers TypeScript on Vercel) |
| [`docs/`](docs/) | Bootstrap spec copy and other docs |

---

## Prerequisites

- **Node.js** ≥ 20 (see root [`package.json`](package.json) `engines`)
- **PostgreSQL** with **pgvector** (e.g. **Neon** via Vercel Storage)
- **OpenAI** API key (chat; embeddings when RAG is implemented)

---

## Environment variables

Copy [`.env.example`](.env.example) and set values. **Next.js** loads env from **`apps/web/`** (e.g. `apps/web/.env.local`). **Prisma CLI** (run from repo root) loads **`.env`** at the **repo root** by default—keep `DATABASE_URL` in **both** places during local dev if you use `.env.local` only under `apps/web`.

| Variable | Used by | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | Prisma, future DB code | Postgres connection string |
| `OPENAI_API_KEY` | `apps/web` `/api/chat` | OpenAI API |
| `CHAT_MODEL` | `/api/chat` | Chat model id (default: `gpt-4o-mini`) |
| `EMBEDDING_MODEL` | Reserved | e.g. `text-embedding-3-small` for RAG (not wired yet) |
| `CRON_SECRET` / `INGEST_CRON_SECRET` | `/api/internal/ingest/step` | Protects cron/internal ingest |
| `ADMIN_SECRET` | Future admin routes | Bootstrap secret |

---

## Setup

```bash
# Install dependencies (runs prisma generate via postinstall)
npm install

# Apply migrations (from repo root; requires DATABASE_URL in root .env)
npm run db:migrate

# Dev server (Next.js; widget script injected in development in layout)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The floating **Chat** control uses the demo tenant (`demo-site` / `pk_test_demo`) in development.

### Production build

```bash
npm run build
```

Builds **`@greenfield/widget`** first, copies `widget.js` into `apps/web/public/`, then builds Next.

### Lint

```bash
npm run lint
```

---

## Widget embed

Build outputs **`widget.js`**. Host it from the Next app (e.g. `/widget.js`) or a CDN. Attributes:

```html
<script
  src="https://YOUR_HOST/widget.js"
  defer
  data-site-id="YOUR_SITE_ID"
  data-publishable-key="YOUR_PUBLISHABLE_KEY"
  data-locale="en"
></script>
```

The script resolves the API base URL from its own `src` origin and `POST`s to `/api/chat` with **SSE** (`data: {"text":"..."}` chunks).

---

## API (summary)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/chat` | Validates `site_id` + publishable key + CORS; streams OpenAI chat completion (SSE) |
| `OPTIONS` | `/api/chat` | CORS preflight |
| `GET` | `/api/internal/ingest/step` | Cron/worker stub; requires `CRON_SECRET` or `INGEST_CRON_SECRET` (Bearer or `?secret=`) |

Tenant allowlist for the demo is still **hardcoded** in [`apps/web/app/api/chat/route.ts`](apps/web/app/api/chat/route.ts); production should load **`Site`** from Postgres per spec §4.

---

## Deployment (Vercel)

- Set the Vercel project **Root Directory** to **`apps/web`**.
- Configure [`apps/web/vercel.json`](apps/web/vercel.json): monorepo `installCommand` / `buildCommand`, cron for ingest step, cache headers for `widget.js`.
- Add the same environment variables in the Vercel dashboard.
- Run **`prisma migrate deploy`** against production (CI or manual), not only `migrate dev`.

---

## Database schema (Prisma)

Models: **`Site`** (tenant + origins + key hash), **`IngestJob`**, **`DocumentChunk`** with **`vector(1536)`** for OpenAI `text-embedding-3-small`-sized embeddings. Migrations live under [`prisma/migrations/`](prisma/migrations/).

---

## Changelog

Add a new **dated** subsection for each meaningful change (features, fixes, infra). Use **ISO date** and a short bullet list.

### 2026-04-12

- Initial monorepo: npm workspaces, `apps/web` (Next.js 16), `packages/widget` (Vite IIFE), root Prisma + initial migration with **pgvector**.
- `POST /api/chat`: tenant/CORS stub, SSE compatible with the widget.
- `GET /api/internal/ingest/step`: secured stub for future chunked ingest + Vercel Cron.
- Docs: `docs/PROJECT_BOOTSTRAP_SPEC.md`; optional `ingest/` placeholder.
- **OpenAI**: streaming **Chat Completions** in `/api/chat` using `OPENAI_API_KEY` and `CHAT_MODEL` (default `gpt-4o-mini`); `EMBEDDING_MODEL` reserved for RAG.
- Tooling: ESLint ignore for built `public/widget.js`; Turbopack root set for monorepo; `openai` SDK in `apps/web`.
