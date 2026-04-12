# Chat Widget + RAG Assistant — Greenfield Project Bootstrap Spec

**Internal / product codename:** `greenfield-chat-widget` (spelling normalized from “greefield”; use the same string in repo names and env prefixes if you prefer the original spelling).

Use this document in an **empty repository** (or monorepo subfolder) to align implementation, ops, and security before writing code. Remaining open items are called out explicitly below (e.g. §0 Q10, human handoff).

---

## 0. Locked decisions (filled)

| # | Question | Your answer |
|---|----------|-------------|
| 1 | **Product / internal codename** | `greenfield-chat-widget` |
| 2 | **Who owns each “site” tenant?** | **Own properties + client sites** (multi-tenant SaaS-style: each embed gets isolated knowledge + keys). |
| 3 | **Data residency / compliance** | **Yes — compliance is a requirement** (treat as GDPR-aware at minimum; add HIPAA/BAA and sector-specific controls if any tenant content or chat could include PHI/PII—see §8). |
| 4 | **Primary LLM provider** | **OpenAI** (chat + embeddings API unless you later split providers). |
| 5 | **Embedding model** | **Default:** `text-embedding-3-small` (fixed for the lifetime of an index; changing it ⇒ full re-embed). Confirm with legal/DPA before production. |
| 6 | **Vector store** | **Recommended (Vercel-aligned):** Postgres **pgvector** via **[Vercel Postgres](https://vercel.com/docs/storage/vercel-postgres)** (Neon under the hood; enables `vector` type and similarity search). Alternatives: see §0.1. |
| 7 | **Primary database** | **Same Postgres** as pgvector for tenants, keys, jobs, and optional chat logs (separate schemas/tables; not separate servers unless scale demands it later). |
| 8 | **Where bulk ingest runs** | **Constraint: stay on Vercel** — use **Route Handlers** + **Vercel Cron** + **chunked/batched work** (see §0.2). Avoid long single invocations; use job rows + pagination. |
| 9 | **Public domains** (initial CORS allowlist) | `https://theexpertways.com`, `https://www.theexpertways.com`, `https://informityx.com`, `https://www.informityx.com` — **more domains added later** as new `site_id` records with their own allowed origins. |
| 10 | **Human handoff** | `[STILL OPEN]` — e.g. mailto, Calendly, CRM ticket, or “contact” deep link per tenant. |

---

## 0.1 Vector storage: hosted options, Vercel, and “local”

### Does Vercel provide a vector database?

**Not as a standalone product named “vector DB.”** On Vercel you typically store embeddings in one of these ways:

| Approach | Fits “deploy on Vercel” | Notes |
|----------|-------------------------|--------|
| **Postgres + pgvector** (e.g. **Vercel Postgres / Neon**) | **Yes — preferred default** | One managed DB for relational data **and** vectors; query from Route Handlers with `ORDER BY embedding <=> query_embedding`. Matches your “single stack” goal. |
| **Third-party hosted vector DB** (Pinecone, Qdrant Cloud, Weaviate Cloud, Turbopuffer, etc.) | **Yes** (app still on Vercel) | Extra vendor + API keys; often excellent scale and filtering. Still compliant-ready if vendor signs your DPA/BAA. |
| **MongoDB Atlas Vector Search**, **Azure AI Search**, etc. | **Yes** | Enterprise paths; more setup. |
| **OpenAI Assistants + file search** | **Partial** | OpenAI hosts retrieval; different product model (files per assistant, not your pgvector). Can be simpler early, weaker for multi-tenant CMS-style control unless carefully designed. |

**Vercel KV (Redis)** is **not** your first choice for primary semantic search at scale; use it for rate limits, sessions, or caches—not as the main vector index.

### If we use a “local” vector database, will it work on Vercel?

**Important distinction:**

- **A database running on your laptop / a VM** (“local” to you): Vercel **can** call it **only if** it is reachable over the internet with stable TLS, firewall rules, and you accept exposing a DB to the public internet (usually **not** recommended vs managed Postgres).
- **“Local” meaning embedded inside the serverless function** (e.g. Chroma/SQLite on disk): **Not suitable for production RAG on Vercel.** Serverless filesystems are **ephemeral**; instances scale out; you do not get a durable co-located vector daemon per deployment.

**Conclusion:** On Vercel, vectors should live in a **remote managed store** (Postgres+pgvector or a hosted vector SaaS). That is the normal and correct pattern—not a literal “local DB process” inside the function.

### Recommendation for this project

1. **Ship v1 with Vercel Postgres + pgvector** (single bill/integration, SQL for tenants + chunks).  
2. **Re-evaluate** hosted vector SaaS only if you outgrow Postgres performance or need exotic hybrid retrieval.

---

## 0.2 “Everything on Vercel” — ingest and heavy PDFs

Your constraint is achievable if you **design ingest as short, idempotent steps**:

- Store **ingest jobs** in Postgres (`pending`, `processing`, `done`, `error`) with cursors (e.g. page range, chunk offset).
- **Vercel Cron** triggers `/api/internal/ingest/step` (or similar) which processes **N chunks per invocation** and exits before `maxDuration`.
- **Route Handlers** accept **webhooks** (e.g. CMS publish) to enqueue work.
- **Python on Vercel:** only if dependencies stay within [Vercel Python limits](https://vercel.com/docs/functions/runtimes/python); heavy scientific stacks may force **TypeScript-only** ingest (e.g. `pdf-parse`, mammoth for DOCX) or slimmer native deps.

If a single PDF is enormous, you may need **higher `maxDuration`** (Vercel Pro/Enterprise) or **split PDF processing** across multiple invocations by page ranges.

**Principle:** the **database** is durable; the **function** is a short worker that advances job state.

---

## 1. Goals

### 1.1 Product goals

- **Embeddable widget** loadable on **multiple websites** with **one codebase**.
- **Per-site knowledge**: answers must be scoped to that site’s indexed content (pages, CMS, PDFs, Word).
- **Conversational UX**: streaming replies, clear tone, optional citations to sources.
- **Grounded answers**: minimize hallucinations via RAG; when context is missing, the bot declines or offers handoff—not invented facts.

### 1.2 Non-goals (initial phase)

- Full voice/video, arbitrary file upload from end-users (unless explicitly scoped later).
- Replacing a full ticketing/CRM system without integration design.
- Training a custom foundation model.

---

## 2. High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Customer websites (N domains)                                   │
│  Each page: <script src="https://[WIDGET_CDN]/widget.js"         │
│             data-site-id="..." data-publishable-key="...">        │
└────────────────────────────┬────────────────────────────────────┘
                             │ HTTPS (chat + optional telemetry)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Vercel project: “greenfield-chat-widget” (Next.js)              │
│  • Widget static bundle + POST /api/chat (streaming)             │
│  • Ingest: Cron + internal routes, chunked jobs (see §0.2)        │
│  • Optional: Python only if bundle/time limits allow               │
└────────────────────────────┬────────────────────────────────────┘
                             │
         ┌───────────────────┼───────────────────┐
         ▼                   ▼                   ▼
   ┌──────────┐       ┌────────────┐      ┌─────────────┐
   │ pgvector │       │ Postgres   │      │ OpenAI API  │
   │ (RAG)    │       │ (same DB:  │      │ (chat +     │
   │          │       │ tenants,   │      │ embeddings) │
   │          │       │ jobs, logs)│      │             │
   └──────────┘       └────────────┘      └─────────────┘
         ▲
         │ upsert from ingest steps
┌────────┴────────────────────────────────────────────────────────┐
│  Same Vercel project: ingest step routes + Cron                 │
│  Enqueue job in DB → each invocation processes N chunks/pages   │
└─────────────────────────────────────────────────────────────────┘
```

**Principle:** the **browser never holds secrets**. It sends a **publishable key** + `site_id`; the server resolves tenant config and retrieval namespace.

---

## 3. Repository layout (recommended monorepo)

Adjust names to taste; this is a sensible default for Next + optional Python ingest.

```
assistant-platform/
  apps/
    web/                      # Next.js (widget static host + API routes + optional admin)
      app/
        api/chat/route.ts       # Main streaming chat endpoint
      public/
        widget.js               # Built embed bundle (or separate package output)
  packages/
    widget/                     # Optional: Vite/Rollup build → single IIFE/UMD for <script>
      src/
  ingest/                       # Python (recommended if you already use Python for PDFs)
      requirements.txt
      cli.py                    # chunk, embed, upsert
  prisma/                       # If using Prisma + Postgres
  docs/
    PROJECT_BOOTSTRAP_SPEC.md   # This file (copied here)
  vercel.json                   # If needed for Python routes, crons, headers
```

**Alternative:** `widget` as a **separate npm package** published to GitHub Packages/npm; `web` depends on it. Same idea, cleaner versioning.

---

## 4. Multi-tenancy model

### 4.1 Tenant identifier

- Every embed includes **`site_id`** (internal UUID or slug) and a **`publishable_key`** (hashed server-side; rotate-able).
- Server validates key ↔ site, then loads:
  - retrieval collection name / partition id,
  - allowed origins (CORS),
  - optional system prompt overrides,
  - feature flags.

### 4.2 Data isolation

- **Vectors**: partition by `site_id` (metadata filter on every query) **or** separate index per site.
- **Logs**: store `site_id` on each conversation row; define retention policy.

### 4.3 CORS

- Allow only origins registered for that `site_id` **or** use a **signed embed token** if origins are dynamic.
- Never use `*` with credentials.

---

## 5. RAG pipeline

### 5.1 Ingestion sources

| Source | Method |
|--------|--------|
| Public website | Crawl sitemap / known URLs, or pull from each site’s CMS API |
| CMS (e.g. headless) | Webhook on publish → re-index single document |
| PDF | Text extraction (e.g. PyMuPDF); respect layout where needed |
| Word (.docx) | Structured text extract; ignore macros |

### 5.2 Chunking

- Target chunk size **500–1,200 tokens** (or ~1–2k characters) with overlap **10–20%**.
- Store metadata: `site_id`, `source_type`, `url`, `document_id`, `title`, `page` (PDF), `chunk_index`, `content_hash`, `updated_at`.

### 5.3 Embeddings

- **Same model** for ingest and query (changing model ⇒ re-embed all chunks for that site).
- Default recommendation: **hosted API** (e.g. OpenAI `text-embedding-3-small`) unless compliance forbids it.
- **Query embedding** on Vercel: call API per message (simple, fast cold start).

### 5.4 Retrieval

- Top-k **5–15** chunks (tune per site).
- Optional: hybrid search (keyword + vector) if you have Postgres full-text.

### 5.5 Generation

- System prompt: answer **only** from context; cite sources; refuse if insufficient.
- Pass **trimmed** context to control tokens; stream response to client.

---

## 6. API contract (sketch)

### 6.1 `POST /api/chat`

**Request (JSON):**

```json
{
  "site_id": "uuid-or-slug",
  "publishable_key": "pk_live_...",
  "messages": [
    { "role": "user", "content": "What services do you offer?" }
  ],
  "session_id": "optional-client-generated-uuid"
}
```

**Response:** `text/event-stream` (SSE) or compatible streaming format your widget consumes.

**Server steps:**

1. Validate key + site + origin.
2. Rate limit (per key + IP).
3. Embed latest user message.
4. Retrieve chunks filtered by `site_id`.
5. Call chat model with context + history (bounded window).
6. Stream tokens; optionally persist transcript if allowed by privacy policy.

### 6.2 Internal/admin (later)

- `POST /api/admin/sites` — register site, issue keys.
- `POST /api/internal/reindex` — secured by secret, triggers ingest job.

---

## 7. Widget embed snippet (example)

Document the **exact** attributes your build expects:

```html
<script
  src="https://[YOUR_WIDGET_HOST]/widget.js"
  defer
  data-site-id="[SITE_ID]"
  data-publishable-key="[PK_LIVE_...]"
  data-locale="en"
></script>
```

**Widget responsibilities:**

- Render launcher + panel; accessibility (focus trap, ESC to close).
- POST to `/api/chat` with streaming reader.
- Optional: show source citations returned as structured events (e.g. final SSE event type `citations`).

---

## 8. Compliance and data processing (OpenAI + multi-tenant)

You indicated **compliance matters** (`§0` Q3). This stack sends user messages and retrieved document snippets to **OpenAI**; treat the following as a working checklist—**not legal advice**.

### 8.1 Roles and agreements

- Execute OpenAI’s **DPA** / appropriate **Business Terms** for your entity; if any workflow touches **PHI**, confirm whether **BAA** coverage is available and in scope for your use case ([OpenAI security and compliance documentation](https://openai.com/security) — verify current offerings with OpenAI and counsel).
- For **client sites** as tenants: define whether you are **processor** or **controller** for chat logs; document in your **DPA** / client agreement.

### 8.2 Data minimization

- **Default:** do **not** persist full chat transcripts unless required; if you store them, set **retention** (e.g. 30/90 days) and support **deletion** requests.
- **Redact** or block highly sensitive categories in prompts if a tenant requires it.
- **Publish** a short privacy notice on the widget or linked policy (what is sent to OpenAI, what is logged).

### 8.3 Technical controls

- **Tenant isolation** in retrieval (`site_id` on every query) and in storage.
- **Access control** on admin/ingest routes (secrets, not publishable keys).
- **Subprocessors:** list OpenAI + Vercel + Postgres host (e.g. Neon) in your privacy policy.

### 8.4 Initial embed domains (reference)

- [theexpertways.com](https://theexpertways.com/) and [informityx.com](https://informityx.com/) — register **`www` and apex** in CORS as in `§0` Q9 when new properties go live.

---

## 9. Security checklist

- [ ] Publishable keys are **revocable** and **scoped** to `site_id`.
- [ ] **No** OpenAI/Anthropic secrets in frontend bundles.
- [ ] Rate limiting + basic bot protection (e.g. Vercel firewall, Turnstile later).
- [ ] PII: define whether you **store** chats; if yes, retention + deletion process.
- [ ] Prompt injection: treat retrieved text as **untrusted**; instructions in system prompt to ignore embedded “ignore previous instructions” in documents where possible (defense in depth, not perfect).
- [ ] Dependency scanning in CI.

---

## 10. Observability

- Structured logs: `site_id`, `request_id`, latency, token usage (if available), retrieval count.
- Error tracking (e.g. Sentry) with PII scrubbing.
- Simple analytics: messages per site/day, opt-out friendly.

---

## 11. Deployment (Vercel)

### 11.1 Single project

- **Next.js** app: primary deployment (widget + APIs + ingest step routes per `§0.2`).
- **Python** (optional): only if `/api/*.py` stays within Vercel size/time limits; otherwise use **TypeScript** for ingest. Enable **`pgvector`** on your Postgres instance via the provider’s extension controls (e.g. Neon: enable extension + run `CREATE EXTENSION IF NOT EXISTS vector;` in migrations).

### 11.2 Environment variables (example names)

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres |
| `OPENAI_API_KEY` | Or your chosen provider |
| `EMBEDDING_MODEL` | Fixed string, versioned |
| `CHAT_MODEL` | Fixed string |
| `INGEST_CRON_SECRET` | Protects cron/internal triggers |
| `ADMIN_SECRET` | Bootstrap admin routes (rotate to proper auth) |

### 11.3 Domains

- `assistant.yourcompany.com` — API + optional admin.
- `cdn.yourcompany.com` or same app under `/widget.js` — long-cache static asset with versioned path (`/v1/widget.js`).

---

## 12. Implementation phases

### Phase A — Skeleton

- [ ] Next app with `POST /api/chat` stub (no RAG).
- [ ] Widget loads, sends message, streams mock text.
- [ ] `site_id` + `publishable_key` validation (hardcoded table OK).

### Phase B — RAG MVP

- [ ] Postgres + pgvector (or chosen store).
- [ ] Ingest CLI: upload 1 PDF + 1 static page → chunks → embed → upsert.
- [ ] Wire retrieval + real LLM; citations in response payload.

### Phase C — Multi-site production

- [ ] Tenant CRUD, key rotation, CORS per site.
- [ ] CMS webhook or scheduled reindex.
- [ ] Monitoring, rate limits, privacy text on widget.

### Phase D — Polish

- [ ] Hybrid search, query rewriting, suggested questions.
- [ ] Human handoff flow per `§0` Q10.

---

## 13. Python vs TypeScript split (guidance)

| Concern | Suggested runtime |
|---------|-------------------|
| Chat API, streaming, Prisma, Vercel-native | **TypeScript** |
| Ingest on Vercel (`§0` Q8) | **TypeScript first** (`pdf-parse`, `mammoth`, etc.) + **chunked Cron/step routes**; add **Python** routes only if deps fit [Vercel Python limits](https://vercel.com/docs/functions/runtimes/python). |

---

## 14. Open questions log

Use this table as you discover gaps:

| Date | Question | Owner | Resolution |
|------|----------|-------|------------|
| | | | |

---

## 15. Glossary

- **RAG:** Retrieval-Augmented Generation — fetch relevant chunks, then ask the LLM to answer using them.
- **Tenant / site:** One embeddable configuration + isolated knowledge base.
- **Publishable key:** Public, revocable credential identifying the tenant embed (not your LLM secret).

---

*End of bootstrap spec. Copy this file into your new project’s `docs/` folder; resolve `§0` Q10 (handoff) before calling the MVP “complete.”*
