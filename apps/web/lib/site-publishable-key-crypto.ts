import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const VERSION = 1;

function deriveKey(): Buffer | null {
  const secret = process.env.ADMIN_SECRET?.trim();
  if (!secret) return null;
  return createHash("sha256").update(secret, "utf8").digest();
}

/**
 * Encrypt publishable key for at-rest storage (admin dashboard copy flow).
 * Returns null if ADMIN_SECRET is not configured.
 */
export function safeEncryptPublishableKey(plaintext: string): string | null {
  const key = deriveKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const out = Buffer.concat([
    Buffer.from([VERSION]),
    iv,
    tag,
    enc,
  ]);
  return out.toString("base64");
}

/**
 * Decrypt value written by safeEncryptPublishableKey. Returns null on missing secret,
 * bad payload, or auth failure.
 */
export function tryDecryptPublishableKey(
  ciphertextB64: string | null | undefined,
): string | null {
  if (!ciphertextB64?.trim()) return null;
  const key = deriveKey();
  if (!key) return null;
  try {
    const buf = Buffer.from(ciphertextB64, "base64");
    if (buf.length < 1 + 12 + 16 + 1) return null;
    if (buf[0] !== VERSION) return null;
    const iv = buf.subarray(1, 13);
    const tag = buf.subarray(13, 29);
    const enc = buf.subarray(29);
    const decipher = createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString(
      "utf8",
    );
    return plain.length > 0 ? plain : null;
  } catch {
    return null;
  }
}
