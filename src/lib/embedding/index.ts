/**
 * Cube Protocol Embedding Service
 *
 * Uses Gemini Embedding 2 for semantic task matching.
 * Embeddings are generated once at task creation, stored in Postgres (pgvector),
 * and their hashes are published to HCS for verification.
 */

import { GoogleGenAI } from "@google/genai";
import { createHash } from "crypto";

export const EMBEDDING_DIMENSIONS = 768;

const EMBEDDING_MODEL = "gemini-embedding-2-preview";

let genai: GoogleGenAI | null = null;

function getGenAI(): GoogleGenAI {
  if (genai) return genai;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY environment variable is not set");
  }

  genai = new GoogleGenAI({ apiKey });
  return genai;
}


export async function generateTaskEmbedding(
  title: string,
  description: string
): Promise<{ embedding: number[]; hash: string }> {
  const ai = getGenAI();

  const text = `${title}\n\n${description}`;

  const response = await ai.models.embedContent({
    model: EMBEDDING_MODEL,
    contents: text,
    config: {
      outputDimensionality: EMBEDDING_DIMENSIONS,
    },
  });

  const embedding = response.embeddings?.[0]?.values;

  if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Invalid embedding response: expected ${EMBEDDING_DIMENSIONS} dimensions`);
  }

  const hash = hashEmbedding(embedding);

  return { embedding, hash };
}


export function hashEmbedding(embedding: number[]): string {
  const str = embedding.map(v => v.toFixed(8)).join(",");
  return createHash("sha256").update(str).digest("hex");
}


export function verifyEmbedding(embedding: number[], expectedHash: string): boolean {
  const actualHash = hashEmbedding(embedding);
  return actualHash === expectedHash;
}


export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Embeddings must have same dimensions");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  normA = Math.sqrt(normA);
  normB = Math.sqrt(normB);

  if (normA === 0 || normB === 0) return 0;

  return dotProduct / (normA * normB);
}


export function findSimilarTasks(
  queryEmbedding: number[],
  taskEmbeddings: Array<{ taskId: string; embedding: number[] }>,
  topK: number = 5
): Array<{ taskId: string; similarity: number }> {
  const results = taskEmbeddings.map(({ taskId, embedding }) => ({
    taskId,
    similarity: cosineSimilarity(queryEmbedding, embedding),
  }));

  results.sort((a, b) => b.similarity - a.similarity);

  return results.slice(0, topK);
}


export function calculateSemanticRelevance(
  taskEmbedding: number[],
  completedTaskEmbeddings: number[][]
): number {
  if (completedTaskEmbeddings.length === 0) {
    // No history - return baseline score
    return 0.1;
  }

  const similarities = completedTaskEmbeddings.map(completed =>
    cosineSimilarity(taskEmbedding, completed)
  );

  similarities.sort((a, b) => b - a);

  // Weight: top match = 50%, second = 25%, third = 12.5%, etc.
  let weightedSum = 0;
  let weightSum = 0;

  for (let i = 0; i < Math.min(similarities.length, 5); i++) {
    const weight = 1 / Math.pow(2, i);
    weightedSum += similarities[i] * weight;
    weightSum += weight;
  }

  const avgSimilarity = weightedSum / weightSum;

  // Convert from [-1, 1] to [0, 1] range (cosine can be negative)
  // In practice, task descriptions are rarely opposite, so mostly [0, 1]
  return Math.max(0, avgSimilarity);
}
