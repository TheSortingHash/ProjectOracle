import "server-only";
import { config } from "./config";
import { EMBEDDING_DIMENSIONS } from "./db/migrations";

// Embedding provider behind a small interface so it can be swapped later.
export interface Embedder {
  readonly name: string;
  embed(texts: string[], inputType: "document" | "query"): Promise<number[][]>;
}

class VoyageEmbedder implements Embedder {
  readonly name = `voyage:${config.voyageModel}`;
  private static BATCH = 128; // well under Voyage's per-request input and token limits

  async embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += VoyageEmbedder.BATCH) {
      const batch = texts.slice(i, i + VoyageEmbedder.BATCH);
      const res = await fetch(`${process.env.VOYAGE_BASE_URL ?? "https://api.voyageai.com/v1"}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        },
        body: JSON.stringify({
          input: batch,
          model: config.voyageModel,
          input_type: inputType,
          output_dimension: EMBEDDING_DIMENSIONS,
        }),
      });
      if (!res.ok) {
        throw new Error(`Voyage embeddings failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
      }
      const json = (await res.json()) as { data: { index: number; embedding: number[] }[] };
      json.data.sort((a, b) => a.index - b.index).forEach((d) => out.push(d.embedding));
    }
    return out;
  }
}

/** Returns null when no embedding provider is configured (full-text search only). */
export function getEmbedder(): Embedder | null {
  return config.hasVoyage ? new VoyageEmbedder() : null;
}

export function toPgVector(v: number[]): string {
  return `[${v.join(",")}]`;
}
