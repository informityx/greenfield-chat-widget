import { createHash } from "node:crypto";

export type ChunkPiece = {
  chunkIndex: number;
  content: string;
  contentHash: string;
};

const DEFAULT_MAX = 1800;
const DEFAULT_OVERLAP = 240;

export function chunkText(
  text: string,
  opts?: { maxChars?: number; overlapChars?: number },
): ChunkPiece[] {
  const maxChars = opts?.maxChars ?? DEFAULT_MAX;
  const overlapChars = Math.min(
    opts?.overlapChars ?? DEFAULT_OVERLAP,
    Math.floor(maxChars * 0.2),
  );

  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const pieces: ChunkPiece[] = [];
  let start = 0;
  let chunkIndex = 0;

  while (start < normalized.length) {
    const end = Math.min(start + maxChars, normalized.length);
    const slice = normalized.slice(start, end);
    if (slice.trim().length > 0) {
      const contentHash = createHash("sha256")
        .update(slice, "utf8")
        .digest("hex");
      pieces.push({ chunkIndex, content: slice, contentHash });
      chunkIndex += 1;
    }
    if (end >= normalized.length) break;
    start = Math.max(end - overlapChars, start + 1);
  }

  return pieces;
}
