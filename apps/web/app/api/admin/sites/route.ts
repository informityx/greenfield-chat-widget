import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { documentIdFromUrl, fetchDocumentFromUrl } from "@/lib/ingest/fetch-document";
import { queueIngestJobForText } from "@/lib/ingest/queue-ingest";
import { hashPublishableKey } from "@/lib/publishable-key";
import { safeEncryptPublishableKey } from "@/lib/site-publishable-key-crypto";

export const runtime = "nodejs";

type CreateBody = {
  siteId?: string;
  siteUrl?: string;
  documentUrl?: string;
  pastedText?: string;
  publishableKey?: string;
};

function originsFromSiteUrl(siteUrl: string): string[] {
  const url = new URL(siteUrl);
  return [url.origin];
}

export async function GET(req: Request) {
  const denied = requireAdminSession(req);
  if (denied) return denied;

  const sites = await prisma.site.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      siteId: true,
      allowedOrigins: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    sites: sites.map((s) => ({
      siteId: s.siteId,
      allowedOrigins: s.allowedOrigins,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
    })),
  });
}

export async function POST(req: Request) {
  const denied = requireAdminSession(req);
  if (denied) return denied;

  const pepper = process.env.PUBLISHABLE_KEY_PEPPER?.trim();
  if (!pepper) {
    return NextResponse.json(
      { error: "Server misconfiguration: PUBLISHABLE_KEY_PEPPER is not set" },
      { status: 503 },
    );
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const siteId = body.siteId?.trim();
  const siteUrl = body.siteUrl?.trim();
  const documentUrl = body.documentUrl?.trim();
  const pastedText = body.pastedText?.trim();

  if (!siteId || !siteUrl) {
    return NextResponse.json(
      { error: "siteId and siteUrl are required." },
      { status: 400 },
    );
  }

  if (!documentUrl && !pastedText) {
    return NextResponse.json(
      { error: "Provide documentUrl or pastedText for RAG knowledge." },
      { status: 400 },
    );
  }

  let allowedOrigins: string[];
  try {
    allowedOrigins = originsFromSiteUrl(siteUrl);
  } catch {
    return NextResponse.json(
      { error: "siteUrl must be a valid absolute URL (e.g. https://example.com)." },
      { status: 400 },
    );
  }

  const existing = await prisma.site.findUnique({ where: { siteId } });
  if (existing) {
    return NextResponse.json(
      { error: `Site already exists: ${siteId}` },
      { status: 409 },
    );
  }

  const publishableKey =
    body.publishableKey?.trim() ||
    `pk_${randomBytes(24).toString("hex")}`;
  if (publishableKey.length < 8) {
    return NextResponse.json(
      { error: "publishableKey must be at least 8 characters if provided." },
      { status: 400 },
    );
  }

  const publishableKeyHash = hashPublishableKey(pepper, publishableKey);
  const publishableKeyEncrypted = safeEncryptPublishableKey(publishableKey);
  if (!publishableKeyEncrypted) {
    return NextResponse.json(
      {
        error:
          "ADMIN_SECRET must be set in apps/web environment (e.g. apps/web/.env.local) so the publishable key can be encrypted for “Generate script”. Restart the dev server after adding it, then register again.",
      },
      { status: 503 },
    );
  }

  let ingest:
    | { chunkCount: number; documentId: string; jobId: string }
    | undefined;
  let fetchTitle: string | null = null;

  const site = await prisma.site.create({
    data: {
      siteId,
      publishableKeyHash,
      publishableKeyEncrypted,
      allowedOrigins,
    },
  });

  try {
    if (documentUrl) {
      const doc = await fetchDocumentFromUrl(documentUrl);
      if (!doc.text.trim()) {
        await prisma.site.delete({ where: { id: site.id } });
        return NextResponse.json(
          { error: "Document URL returned no extractable text." },
          { status: 400 },
        );
      }
      const documentId = documentIdFromUrl(documentUrl);
      fetchTitle = doc.title;
      ingest = await queueIngestJobForText(prisma, site.id, {
        rawText: doc.text,
        documentId,
        title: doc.title ?? documentId.slice(0, 16),
        sourceType: doc.sourceType,
        sourceUrl: doc.sourceUrl,
      });
    } else {
      const documentId = `pasted-${Date.now().toString(36)}`;
      ingest = await queueIngestJobForText(prisma, site.id, {
        rawText: pastedText!,
        documentId,
        title: "Pasted content",
        sourceType: "text",
        sourceUrl: null,
      });
    }
  } catch (e) {
    await prisma.site.delete({ where: { id: site.id } }).catch(() => {});
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    siteId,
    publishableKey,
    allowedOrigins,
    ingest: ingest
      ? {
          jobId: ingest.jobId,
          documentId: ingest.documentId,
          chunkCount: ingest.chunkCount,
        }
      : null,
    title: fetchTitle,
  });
}
