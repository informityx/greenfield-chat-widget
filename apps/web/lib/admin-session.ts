import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_COOKIE = "gf_admin_session";

const SESSION_VERSION = 1;
const MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

type SessionPayload = {
  v: number;
  exp: number;
  n: string;
};

function timingSafeStringEqual(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a, "utf8");
    const bb = Buffer.from(b, "utf8");
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function signPayload(secret: string, payloadB64Url: string): string {
  return createHmac("sha256", secret)
    .update(payloadB64Url, "utf8")
    .digest("base64url");
}

function encodePayload(payload: SessionPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodePayload(payloadB64Url: string): SessionPayload | null {
  try {
    const json = Buffer.from(payloadB64Url, "base64url").toString("utf8");
    const o = JSON.parse(json) as SessionPayload;
    if (o.v !== SESSION_VERSION || typeof o.exp !== "number" || typeof o.n !== "string") {
      return null;
    }
    return o;
  } catch {
    return null;
  }
}

export function issueAdminSessionToken(secret: string): string {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE_SEC;
  const payload: SessionPayload = {
    v: SESSION_VERSION,
    exp,
    n: randomBytes(16).toString("hex"),
  };
  const payloadB64 = encodePayload(payload);
  const sig = signPayload(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

export function verifyAdminSessionToken(
  secret: string | undefined,
  token: string | undefined,
): boolean {
  if (!secret || !token) return false;
  const i = token.lastIndexOf(".");
  if (i <= 0) return false;
  const payloadB64 = token.slice(0, i);
  const sig = token.slice(i + 1);
  if (!payloadB64 || !sig) return false;
  const expected = signPayload(secret, payloadB64);
  if (!timingSafeStringEqual(sig, expected)) return false;
  const payload = decodePayload(payloadB64);
  if (!payload) return false;
  if (payload.exp < Math.floor(Date.now() / 1000)) return false;
  return true;
}

export function getAdminSessionTokenFromRequest(req: Request): string | undefined {
  const raw = req.headers.get("cookie");
  if (!raw) return undefined;
  for (const part of raw.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === ADMIN_SESSION_COOKIE) {
      return decodeURIComponent(rest.join("=").trim());
    }
  }
  return undefined;
}

export function adminSessionCookieHeader(
  token: string,
  maxAgeSec: number = MAX_AGE_SEC,
): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

export function clearAdminSessionCookieHeader(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function requireAdminSecret(): string | null {
  const s = process.env.ADMIN_SECRET?.trim();
  return s && s.length > 0 ? s : null;
}
