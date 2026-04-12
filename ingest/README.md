# Optional Python ingest

Primary ingest for this project is **TypeScript** on Vercel (Route Handlers + Cron + chunked jobs). See `docs/PROJECT_BOOTSTRAP_SPEC.md` §0.2 and §13.

Use this folder only if you add a **Python** CLI or worker (e.g. PyMuPDF) and accept Vercel Python runtime limits for any server routes.
