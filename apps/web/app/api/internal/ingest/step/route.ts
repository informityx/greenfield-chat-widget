import { NextResponse } from "next/server";

/**
 * Chunked ingest worker (§0.2). Cron calls GET with secret; implement N chunks per invocation in Phase B.
 */
export async function GET(req: Request) {
  const secrets = [
    process.env.CRON_SECRET,
    process.env.INGEST_CRON_SECRET,
  ].filter((s): s is string => Boolean(s));
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : null;
  const q = new URL(req.url).searchParams.get("secret");

  const ok =
    secrets.length > 0 &&
    secrets.some((s) => s === token || s === q);

  if (!ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    message: "Ingest step stub — no work processed yet (Phase A).",
    processed: 0,
  });
}
