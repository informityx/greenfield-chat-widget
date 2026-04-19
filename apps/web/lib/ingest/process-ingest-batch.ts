import OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";
import { embedTexts } from "@/lib/rag/embeddings";
import { insertChunkRow } from "@/lib/rag/insert-chunks";

export const INGEST_BATCH_SIZE = 8;

export type PendingChunk = {
  chunkIndex: number;
  content: string;
  contentHash: string;
  sourceType: string;
  sourceUrl: string | null;
  documentId: string;
  title: string | null;
  page: number | null;
};

export type IngestCursorV1 = {
  v: 1;
  documentId: string;
  embeddingModel: string;
  pending: PendingChunk[];
  nextIndex: number;
};

export function isIngestCursorV1(x: unknown): x is IngestCursorV1 {
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

export type ProcessIngestBatchResult =
  | {
      ok: true;
      noJob: true;
      processed: 0;
      message: string;
    }
  | {
      ok: true;
      noJob?: false;
      jobId: string;
      documentId: string;
      processed: number;
      remaining: number;
      done: boolean;
      message?: string;
    }
  | {
      ok: false;
      error: string;
      httpStatus: number;
    };

/**
 * Picks the oldest pending ingest job, embeds up to INGEST_BATCH_SIZE chunks, inserts rows, updates cursor.
 * Shared by cron `/api/internal/ingest/step` and admin `run-once`.
 */
export async function processNextIngestBatch(
  prisma: PrismaClient,
  apiKey: string,
): Promise<ProcessIngestBatchResult> {
  const job = await prisma.ingestJob.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  if (!job) {
    return {
      ok: true,
      noJob: true,
      processed: 0,
      message: "No pending ingest jobs.",
    };
  }

  const cursorRaw = job.cursor;
  if (!isIngestCursorV1(cursorRaw)) {
    await prisma.ingestJob.update({
      where: { id: job.id },
      data: {
        status: "error",
        errorMessage: "Invalid job cursor shape",
      },
    });
    return {
      ok: false,
      error: "Invalid cursor",
      httpStatus: 400,
    };
  }

  const cursor = cursorRaw;
  const { pending, nextIndex, embeddingModel, documentId } = cursor;
  if (nextIndex >= pending.length) {
    await prisma.ingestJob.update({
      where: { id: job.id },
      data: { status: "done" },
    });
    return {
      ok: true,
      jobId: job.id,
      documentId,
      processed: 0,
      remaining: 0,
      done: true,
      message: "Job already complete.",
    };
  }

  await prisma.ingestJob.update({
    where: { id: job.id },
    data: { status: "processing" },
  });

  try {
    const slice = pending.slice(nextIndex, nextIndex + INGEST_BATCH_SIZE);
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

    return {
      ok: true,
      jobId: job.id,
      documentId,
      processed: slice.length,
      remaining: Math.max(0, pending.length - newNext),
      done,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.ingestJob.update({
      where: { id: job.id },
      data: {
        status: "error",
        errorMessage: msg,
      },
    });
    return {
      ok: false,
      error: msg,
      httpStatus: 500,
    };
  }
}
