import type { PrismaClient } from "@prisma/client";

export type RetrievedChunk = {
  id: string;
  content: string;
  title: string | null;
  sourceUrl: string | null;
  /** Cosine distance from pgvector (`<=>`); lower is more similar (same ordering as retrieval). */
  distance: number;
};

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.map((n) => Number(n)).join(",")}]`;
}

export async function retrieveSimilarChunks(
  prisma: PrismaClient,
  siteUuid: string,
  embedding: number[],
  topK: number,
): Promise<RetrievedChunk[]> {
  const lit = vectorLiteral(embedding);
  const rows = await prisma.$queryRawUnsafe<RetrievedChunk[]>(
    `
    SELECT
      id::text AS id,
      content,
      title,
      source_url AS "sourceUrl",
      (embedding <=> $2::vector) AS distance
    FROM document_chunks
    WHERE site_id = $1::uuid
      AND embedding IS NOT NULL
    ORDER BY distance ASC
    LIMIT $3
    `,
    siteUuid,
    lit,
    topK,
  );
  return rows.map((r) => ({
    ...r,
    distance: Number(r.distance),
  }));
}
