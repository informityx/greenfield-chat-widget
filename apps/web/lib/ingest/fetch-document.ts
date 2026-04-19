import { createHash } from "node:crypto";

const MAX_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;

export type FetchedDocument = {
  text: string;
  sourceType: string;
  sourceUrl: string;
  title: string | null;
};

function isPrivateIpv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if ([a, b, c, d].some((n) => n > 255)) return false;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "0.0.0.0") return true;
  if (h.endsWith(".internal") || h.endsWith(".local")) return true;
  return false;
}

function isPrivateIpv6(host: string): boolean {
  const x = host.toLowerCase();
  if (x.startsWith("::ffff:")) {
    const v4 = x.slice("::ffff:".length);
    return isPrivateIpv4(v4);
  }
  if (x.startsWith("fc") || x.startsWith("fd")) return true;
  if (x.startsWith("fe80:")) return true;
  if (x === "::1") return true;
  return false;
}

/**
 * Reject URLs that point to obvious private/link-local targets (SSRF mitigation).
 */
export function assertUrlSafeForFetch(url: URL): void {
  if (url.protocol !== "https:") {
    throw new Error("Only https:// document URLs are allowed.");
  }
  const host = url.hostname;
  if (!host) throw new Error("Invalid URL host.");
  if (isBlockedHostname(host)) throw new Error("Host is not allowed.");
  if (isPrivateIpv4(host)) throw new Error("Private IPv4 addresses are not allowed.");
  if (host.includes(":") && isPrivateIpv6(host)) {
    throw new Error("Private or local IPv6 addresses are not allowed.");
  }
}

async function readBodyWithLimit(
  res: Response,
  maxBytes: number,
): Promise<ArrayBuffer> {
  const cl = res.headers.get("content-length");
  if (cl) {
    const n = Number.parseInt(cl, 10);
    if (Number.isFinite(n) && n > maxBytes) {
      throw new Error(`Response too large (content-length ${n}).`);
    }
  }
  if (!res.body) {
    const buf = await res.arrayBuffer();
    if (buf.byteLength > maxBytes) throw new Error("Response too large.");
    return buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > maxBytes) {
      reader.cancel().catch(() => {});
      throw new Error("Response too large.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.buffer;
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function guessTitleFromHtml(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m) return null;
  const t = m[1]!.replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: Buffer.from(buf) });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}

/**
 * Fetch a public HTTPS document and return plain text for chunking / RAG.
 */
export async function fetchDocumentFromUrl(
  inputUrl: string,
): Promise<FetchedDocument> {
  let url: URL;
  try {
    url = new URL(inputUrl);
  } catch {
    throw new Error("Invalid document URL.");
  }
  assertUrlSafeForFetch(url);

  const res = await fetch(url.toString(), {
    redirect: "follow",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: {
      "user-agent": "GreenfieldChatWidget-Ingest/1.0",
      accept: "application/pdf,text/html,text/plain,text/markdown,*/*;q=0.8",
    },
  });

  let finalUrl: URL;
  try {
    finalUrl = new URL(res.url);
  } catch {
    throw new Error("Invalid redirect target URL.");
  }
  assertUrlSafeForFetch(finalUrl);

  if (!res.ok) {
    throw new Error(`Fetch failed with status ${res.status}.`);
  }

  const buf = await readBodyWithLimit(res, MAX_BYTES);
  const ct = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();

  if (ct === "application/pdf" || ct.includes("pdf")) {
    const text = await extractPdfText(buf);
    return {
      text,
      sourceType: "pdf",
      sourceUrl: finalUrl.toString(),
      title: finalUrl.pathname.split("/").filter(Boolean).pop() ?? null,
    };
  }

  if (
    ct.includes("html") ||
    ct === "application/xhtml+xml" ||
    ct === ""
  ) {
    const raw = new TextDecoder("utf8", { fatal: false }).decode(buf);
    if (raw.trimStart().startsWith("<") || ct.includes("html")) {
      return {
        text: htmlToText(raw),
        sourceType: "html",
        sourceUrl: finalUrl.toString(),
        title: guessTitleFromHtml(raw),
      };
    }
    return {
      text: raw.trim(),
      sourceType: "text",
      sourceUrl: finalUrl.toString(),
      title: null,
    };
  }

  if (
    ct.startsWith("text/") ||
    ct === "application/json" ||
    ct === "application/xml"
  ) {
    const raw = new TextDecoder("utf8", { fatal: false }).decode(buf);
    return {
      text: raw.trim(),
      sourceType: "text",
      sourceUrl: finalUrl.toString(),
      title: null,
    };
  }

  const fallback = new TextDecoder("utf8", { fatal: false }).decode(buf);
  return {
    text: fallback.trim(),
    sourceType: "text",
    sourceUrl: finalUrl.toString(),
    title: null,
  };
}

export function documentIdFromUrl(url: string): string {
  return createHash("sha256").update(url, "utf8").digest("hex").slice(0, 32);
}
