import { customAlphabet } from "nanoid";
import { createHash } from "crypto";

// URL-safe ID generator
const nanoid = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  21
);

export function generateId(prefix: string): string {
  return `${prefix}_${nanoid()}`;
}

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function formatHbar(amount: number | string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  return `${num.toFixed(2)} HBAR`;
}
