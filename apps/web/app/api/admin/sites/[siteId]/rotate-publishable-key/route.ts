import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { hashPublishableKey } from "@/lib/publishable-key";
import { safeEncryptPublishableKey } from "@/lib/site-publishable-key-crypto";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ siteId: string }> };

export async function POST(request: Request, ctx: RouteCtx) {
  const denied = requireAdminSession(request);
  if (denied) return denied;

  const pepper = process.env.PUBLISHABLE_KEY_PEPPER?.trim();
  if (!pepper) {
    return NextResponse.json(
      { error: "Server misconfiguration: PUBLISHABLE_KEY_PEPPER is not set" },
      { status: 503 },
    );
  }

  const { siteId: raw } = await ctx.params;
  const siteId = decodeURIComponent(raw);
  const site = await prisma.site.findUnique({ where: { siteId } });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  const publishableKey = `pk_${randomBytes(24).toString("hex")}`;
  const publishableKeyHash = hashPublishableKey(pepper, publishableKey);
  const publishableKeyEncrypted = safeEncryptPublishableKey(publishableKey);
  if (!publishableKeyEncrypted) {
    return NextResponse.json(
      {
        error:
          "ADMIN_SECRET must be set so the new key can be encrypted for Generate script. Set it in apps/web/.env.local and restart.",
      },
      { status: 503 },
    );
  }

  await prisma.site.update({
    where: { id: site.id },
    data: {
      publishableKeyHash,
      publishableKeyEncrypted,
    },
  });

  return NextResponse.json({
    ok: true,
    siteId,
    publishableKey,
    rotated: true,
  });
}
