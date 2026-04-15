import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256(pepper, key) as hex. Must match `prisma/seed.ts` and any admin tooling.
 */
export function hashPublishableKey(pepper: string, publishableKey: string): string {
  return createHmac("sha256", pepper).update(publishableKey, "utf8").digest("hex");
}

export function verifyPublishableKey(
  pepper: string | undefined,
  publishableKey: string,
  storedHashHex: string,
): boolean {
  if (!pepper) return false;
  const computed = hashPublishableKey(pepper, publishableKey);
  try {
    const a = Buffer.from(computed, "hex");
    const b = Buffer.from(storedHashHex, "hex");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
