import type { Site } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { verifyPublishableKey } from "@/lib/publishable-key";

export function parseAllowedOrigins(json: unknown): string[] {
  if (!Array.isArray(json)) return [];
  return json.filter((x): x is string => typeof x === "string");
}

export type ResolvedSite = {
  site: Site;
  allowedOrigins: string[];
};

export async function resolveSiteWithKey(
  siteIdSlug: string | undefined,
  publishableKey: string | undefined,
): Promise<
  | { ok: true; data: ResolvedSite }
  | { ok: false; status: 401 | 404 }
> {
  if (!siteIdSlug?.trim() || !publishableKey) {
    return { ok: false, status: 401 };
  }

  const site = await prisma.site.findUnique({
    where: { siteId: siteIdSlug.trim() },
  });

  if (!site) {
    return { ok: false, status: 404 };
  }

  const pepper = process.env.PUBLISHABLE_KEY_PEPPER;
  if (
    !verifyPublishableKey(pepper, publishableKey, site.publishableKeyHash)
  ) {
    return { ok: false, status: 401 };
  }

  return {
    ok: true,
    data: {
      site,
      allowedOrigins: parseAllowedOrigins(site.allowedOrigins),
    },
  };
}
