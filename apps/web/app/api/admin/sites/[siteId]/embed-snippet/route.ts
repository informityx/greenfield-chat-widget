import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/admin-auth";
import { prisma } from "@/lib/prisma";
import { tryDecryptPublishableKey } from "@/lib/site-publishable-key-crypto";
import { verifyPublishableKey } from "@/lib/publishable-key";
import { buildWidgetEmbedSnippet } from "@/lib/widget-embed-snippet";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ siteId: string }> };

/**
 * Returns the full widget embed HTML for an admin-authenticated session.
 * Uses encrypted key (ADMIN_SECRET) or verified demo env key for demo-site.
 */
export async function GET(request: Request, ctx: RouteCtx) {
  const denied = requireAdminSession(request);
  if (denied) return denied;

  const { siteId: raw } = await ctx.params;
  const siteId = decodeURIComponent(raw);

  const ref = request.headers.get("referer");
  let origin = request.headers.get("x-embed-origin")?.trim() ?? "";
  if (!origin && ref) {
    try {
      origin = new URL(ref).origin;
    } catch {
      origin = "";
    }
  }
  if (!origin) {
    return NextResponse.json(
      { error: "Send x-embed-origin header (e.g. https://your-host.com)" },
      { status: 400 },
    );
  }
  try {
    new URL(origin);
  } catch {
    return NextResponse.json({ error: "Invalid x-embed-origin URL" }, { status: 400 });
  }

  const site = await prisma.site.findUnique({ where: { siteId } });
  if (!site) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }

  let publishableKey: string | null = tryDecryptPublishableKey(
    site.publishableKeyEncrypted,
  );
  let keyMode: "vault" | "demo_env" = "vault";

  if (publishableKey) {
    const pepper = process.env.PUBLISHABLE_KEY_PEPPER;
    if (verifyPublishableKey(pepper, publishableKey, site.publishableKeyHash)) {
      keyMode = "vault";
    } else {
      publishableKey = null;
    }
  }

  if (!publishableKey && siteId === "demo-site") {
    const demoKey =
      process.env.ADMIN_DEMO_PUBLISHABLE_KEY?.trim() ||
      process.env.SEED_DEMO_PUBLISHABLE_KEY?.trim();
    const pepper = process.env.PUBLISHABLE_KEY_PEPPER;
    if (
      demoKey &&
      verifyPublishableKey(pepper, demoKey, site.publishableKeyHash)
    ) {
      publishableKey = demoKey;
      keyMode = "demo_env";
    }
  }

  if (!publishableKey) {
    return NextResponse.json(
      {
        error:
          "No publishable key is available for this site in the dashboard (it was created before encrypted storage, or ADMIN_SECRET was missing when it was created). Use **Rotate key** on this row to issue a new key — it will be stored encrypted — then **Generate script** will work.",
        code: "NO_STORED_PUBLISHABLE_KEY",
      },
      { status: 409 },
    );
  }

  const snippet = buildWidgetEmbedSnippet({
    scriptOrigin: origin,
    siteId: site.siteId,
    publishableKey,
    locale: "en",
  });

  return NextResponse.json({
    ok: true,
    snippet,
    keyMode,
  });
}
