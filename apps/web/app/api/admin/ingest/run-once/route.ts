import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { processNextIngestBatch } from "@/lib/ingest/process-ingest-batch";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const denied = requireAdminSession(req);
  if (denied) return denied;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 503 },
    );
  }

  const result = await processNextIngestBatch(prisma, apiKey);

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error },
      { status: result.httpStatus },
    );
  }

  if ("noJob" in result && result.noJob) {
    return NextResponse.json({
      ok: true,
      idle: true,
      message: result.message,
      processed: 0,
    });
  }

  return NextResponse.json({
    ok: true,
    jobId: result.jobId,
    documentId: result.documentId,
    processed: result.processed,
    remaining: result.remaining,
    done: result.done,
    ...(result.message ? { message: result.message } : {}),
  });
}
