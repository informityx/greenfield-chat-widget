import type OpenAI from "openai";

const BATCH = 64;

export async function embedTexts(
  openai: OpenAI,
  model: string,
  inputs: string[],
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < inputs.length; i += BATCH) {
    const batch = inputs.slice(i, i + BATCH);
    const res = await openai.embeddings.create({ model, input: batch });
    const sorted = [...res.data].sort((a, b) => a.index - b.index);
    for (const d of sorted) {
      out.push(d.embedding);
    }
  }
  return out;
}
