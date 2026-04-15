import OpenAI from "openai";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { embedTexts } from "@/lib/rag/embeddings";
import { insertChunkRow } from "@/lib/rag/insert-chunks";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH = 8;

type PendingChunk = {
  chunkIndex: number;
  content: string;
  contentHash: string;
  sourceType: string;
  sourceUrl: string | null;
  documentId: string;
  title: string | null;
  page: number | null;
};

type IngestCursor = {
  v: 1;
  documentId: string;
  embeddingModel: string;
  pending: PendingChunk[];
  nextIndex: number;
};

function isCursor(x: unknown): x is IngestCursor {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.documentId === "string" &&
    typeof o.embeddingModel === "string" &&
    Array.isArray(o.pending) &&
    typeof o.nextIndex === "number"
  );
}

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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY not configured" },
      { status: 503 },
    );
  }

  const job = await prisma.ingestJob.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    return NextResponse.json({
      ok: true,
      message: "No pending ingest jobs.",
      processed: 0,
    });
  }

  const cursorRaw = job.cursor;
  if (!isCursor(cursorRaw)) {
    await prisma.ingestJob.update({
      where: { id: job.id },
      data: {
        status: "error",
        errorMessage: "Invalid job cursor shape",
      },
    });
    return NextResponse.json(
      { ok: false, error: "Invalid cursor" },
      { status: 400 },
    );
  }

  const cursor = cursorRaw;
  const { pending, nextIndex, embeddingModel, documentId } = cursor;
  if (nextIndex >= pending.length) {
    await prisma.ingestJob.update({
      where: { id: job.id },
      data: { status: "done" },
    });
    return NextResponse.json({
      ok: true,
      message: "Job already complete.",
      processed: 0,
    });
  }

  await prisma.ingestJob.update({
    where: { id: job.id },
    data: { status: "processing" },
  });

  try {
    const slice = pending.slice(nextIndex, nextIndex + BATCH);
    const openai = new OpenAI({ apiKey });
    const vectors = await embedTexts(
      openai,
      embeddingModel,
      slice.map((p) => p.content),
    );

    for (let i = 0; i < slice.length; i++) {
      const p = slice[i]!;
      const embedding = vectors[i]!;
      await insertChunkRow(prisma, job.siteId, {
        chunkIndex: p.chunkIndex,
        content: p.content,
        contentHash: p.contentHash,
        sourceType: p.sourceType,
        sourceUrl: p.sourceUrl,
        documentId: p.documentId,
        title: p.title,
        page: p.page,
        embedding,
      });
    }

    const newNext = nextIndex + slice.length;
    const done = newNext >= pending.length;

    await prisma.ingestJob.update({
      where: { id: job.id },
      data: {
        status: done ? "done" : "pending",
        cursor: {
          ...cursor,
          nextIndex: newNext,
        } as object,
        ...(done ? {} : { errorMessage: null }),
      },
    });

    return NextResponse.json({
      ok: true,
      jobId: job.id,
      documentId,
      processed: slice.length,
      remaining: Math.max(0, pending.length - newNext),
      done,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.ingestJob.update({
      where: { id: job.id },
      data: {
        status: "error",
        errorMessage: msg,
      },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
