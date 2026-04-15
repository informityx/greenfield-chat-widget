import type { PrismaClient } from "@prisma/client";

export type RetrievedChunk = {
  id: string;
  content: string;
  title: string | null;
  sourceUrl: string | null;
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
  return prisma.$queryRawUnsafe<RetrievedChunk[]>(
    `
    SELECT
      id::text AS id,
      content,
      title,
      source_url AS "sourceUrl"
    FROM document_chunks
    WHERE site_id = $1::uuid
      AND embedding IS NOT NULL
    ORDER BY embedding <=> $2::vector
    LIMIT $3
    `,
    siteUuid,
    lit,
    topK,
  );
}
