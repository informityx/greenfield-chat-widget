/**
 * Ingest local .md / .txt / .html or PDF into document_chunks (idempotent per document_id).
 *
 * Usage (from repo root, with env loaded):
 *   cd apps/web && npx dotenv -e .env.local -- npx tsx scripts/ingest-file.ts --site demo-site --text ./content/sample.md
 *   cd apps/web && npx dotenv -e .env.local -- npx tsx scripts/ingest-file.ts --site demo-site --pdf ./content/sample.pdf
 *
 * Or: npm run ingest -w web -- --site demo-site --text ./content/sample.md
 *
 * Optional: --queue  enqueue chunked work for GET /api/internal/ingest/step (batched embed + insert)
 */

import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { config } from "dotenv";
import OpenAI from "openai";

import { prisma } from "../lib/prisma";
import { chunkText } from "../lib/rag/chunk";
import { embedTexts } from "../lib/rag/embeddings";
import { replaceDocumentChunks } from "../lib/rag/insert-chunks";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env") });
config({ path: resolve(process.cwd(), "../.env") });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1 || !process.argv[i + 1]) return undefined;
  return process.argv[i + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function extractPdfText(buf: Buffer): Promise<string> {
  // Lazy-import PDF parser so text-only ingest doesn't require DOM APIs.
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: buf });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}

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

async function main() {
  const siteSlug = arg("--site");
  const textPath = arg("--text");
  const pdfPath = arg("--pdf");
  const queue = hasFlag("--queue");

  if (!siteSlug || (!textPath && !pdfPath) || (textPath && pdfPath)) {
    console.error(
      "Usage: ingest-file.ts --site <site_id> (--text <path> | --pdf <path>) [--queue]",
    );
    process.exit(1);
  }

  const filePath = resolve(process.cwd(), textPath ?? pdfPath!);
  const documentId =
    arg("--document-id") ?? basename(filePath).replace(/\s+/g, "_");
  const title = arg("--title") ?? basename(filePath);

  const apiKey = process.env.OPENAI_API_KEY;
  const embeddingModel =
    process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small";

  if (!apiKey) {
    console.error("OPENAI_API_KEY is required.");
    process.exit(1);
  }

  const site = await prisma.site.findUnique({
    where: { siteId: siteSlug },
  });
  if (!site) {
    console.error(`Site not found: ${siteSlug}`);
    process.exit(1);
  }

  let raw: string;
  let sourceType: string;
  if (textPath) {
    raw = await readFile(filePath, "utf8");
    const ext = basename(filePath).toLowerCase();
    if (ext.endsWith(".html") || ext.endsWith(".htm")) {
      sourceType = "html";
    } else {
      sourceType = "text";
    }
  } else {
    const buf = await readFile(filePath);
    raw = await extractPdfText(buf);
    sourceType = "pdf";
  }

  const pieces = chunkText(raw);
  if (pieces.length === 0) {
    console.error("No text extracted or empty after chunking.");
    process.exit(1);
  }

  const sourceUrl = arg("--url") ?? `file://${basename(filePath)}`;

  const pending: PendingChunk[] = pieces.map((p) => ({
    chunkIndex: p.chunkIndex,
    content: p.content,
    contentHash: p.contentHash,
    sourceType,
    sourceUrl,
    documentId,
    title,
    page: null,
  }));

  if (queue) {
    await prisma.$executeRawUnsafe(
      `DELETE FROM document_chunks WHERE site_id = $1::uuid AND document_id = $2`,
      site.id,
      documentId,
    );
    await prisma.ingestJob.create({
      data: {
        siteId: site.id,
        status: "pending",
        cursor: {
          v: 1,
          documentId,
          embeddingModel,
          pending,
          nextIndex: 0,
        },
      },
    });
    console.log(
      `Queued ingest job for ${documentId} (${pending.length} chunks). Run ingest step worker.`,
    );
    return;
  }

  const openai = new OpenAI({ apiKey });
  const embeddings = await embedTexts(
    openai,
    embeddingModel,
    pending.map((p) => p.content),
  );

  const rows = pending.map((p, i) => ({
    chunkIndex: p.chunkIndex,
    content: p.content,
    contentHash: p.contentHash,
    sourceType: p.sourceType,
    sourceUrl: p.sourceUrl,
    documentId: p.documentId,
    title: p.title,
    page: p.page,
    embedding: embeddings[i]!,
  }));

  await replaceDocumentChunks(prisma, site.id, documentId, rows);
  console.log(
    `Ingested ${rows.length} chunks for site=${siteSlug} document=${documentId}`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
