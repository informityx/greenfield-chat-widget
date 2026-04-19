import type { PrismaClient } from "@prisma/client";
import { chunkText } from "@/lib/rag/chunk";
import type { PendingChunk } from "@/lib/ingest/process-ingest-batch";

export async function queueIngestJobForText(
  prisma: PrismaClient,
  siteUuid: string,
  input: {
    rawText: string;
    documentId: string;
    title: string | null;
    sourceType: string;
    sourceUrl: string | null;
  },
): Promise<{ chunkCount: number; documentId: string; jobId: string }> {
  const embeddingModel =
    process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";
  const pieces = chunkText(input.rawText);
  if (pieces.length === 0) {
    throw new Error("No text to ingest after chunking.");
  }

  const pending: PendingChunk[] = pieces.map((p) => ({
    chunkIndex: p.chunkIndex,
    content: p.content,
    contentHash: p.contentHash,
    sourceType: input.sourceType,
    sourceUrl: input.sourceUrl,
    documentId: input.documentId,
    title: input.title,
    page: null,
  }));

  await prisma.$executeRawUnsafe(
    `DELETE FROM document_chunks WHERE site_id = $1::uuid AND document_id = $2`,
    siteUuid,
    input.documentId,
  );

  const job = await prisma.ingestJob.create({
    data: {
      siteId: siteUuid,
      status: "pending",
      cursor: {
        v: 1,
        documentId: input.documentId,
        embeddingModel,
        pending,
        nextIndex: 0,
      },
    },
  });

  return {
    chunkCount: pending.length,
    documentId: input.documentId,
    jobId: job.id,
  };
}
