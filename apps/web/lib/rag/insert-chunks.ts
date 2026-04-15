import type { PrismaClient } from "@prisma/client";

export type ChunkInsert = {
  chunkIndex: number;
  content: string;
  contentHash: string;
  sourceType: string;
  sourceUrl: string | null;
  documentId: string;
  title: string | null;
  page: number | null;
  embedding: number[];
};

function vectorLiteral(embedding: number[]): string {
  return `[${embedding.map((n) => Number(n)).join(",")}]`;
}

export async function insertChunkRow(
  prisma: PrismaClient,
  siteUuid: string,
  r: ChunkInsert,
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO document_chunks (
      id,
      site_id,
      source_type,
      source_url,
      document_id,
      title,
      page,
      chunk_index,
      content,
      content_hash,
      embedding,
      updated_at
    ) VALUES (
      gen_random_uuid(),
      $1::uuid,
      $2,
      $3,
      $4,
      $5,
      $6,
      $7,
      $8,
      $9,
      $10::vector,
      NOW()
    )
    `,
    siteUuid,
    r.sourceType,
    r.sourceUrl,
    r.documentId,
    r.title,
    r.page,
    r.chunkIndex,
    r.content,
    r.contentHash,
    vectorLiteral(r.embedding),
  );
}

export async function replaceDocumentChunks(
  prisma: PrismaClient,
  siteUuid: string,
  documentId: string,
  rows: ChunkInsert[],
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DELETE FROM document_chunks WHERE site_id = $1::uuid AND document_id = $2`,
    siteUuid,
    documentId,
  );

  for (const r of rows) {
    await insertChunkRow(prisma, siteUuid, r);
  }
}
