import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseInputContent } from "openai/resources/responses/responses";
import type { z } from "zod";

/**
 * Two tiers, as in the proposal: a fast model for high-volume CV parsing/scoring,
 * and a stronger model for question design, interview scoring and reports.
 */
export const MODELS = {
  fast: process.env.AI_MODEL_FAST || "gpt-5-mini",
  smart: process.env.AI_MODEL_SMART || "gpt-5",
} as const;

export const isDemoMode = () => process.env.AI_DEMO_MODE === "true";

export class AiConfigError extends Error {}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new AiConfigError("OPENAI_API_KEY is not configured");
  }
  client ??= new OpenAI({ maxRetries: 4, timeout: 5 * 60_000 });
  return client;
}

export type Content = string | ResponseInputContent[];

export async function structured<S extends z.ZodType>(opts: {
  tier: keyof typeof MODELS;
  system: string;
  content: Content;
  schema: S;
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; model: string }> {
  const model = MODELS[opts.tier];
  const res = await getClient().responses.parse({
    model,
    instructions: opts.system,
    input: [{ role: "user", content: opts.content }],
    max_output_tokens: opts.maxTokens ?? 16000,
    text: { format: zodTextFormat(opts.schema, "result") },
  });
  if (res.status === "incomplete") {
    throw new Error(`Model output was incomplete (${res.incomplete_details?.reason ?? "unknown reason"})`);
  }
  if (res.status !== "completed") throw new Error(`Model returned status "${res.status}"`);
  if (res.output_parsed == null) throw new Error("Model returned output that did not match the schema");
  return { data: res.output_parsed as z.infer<S>, model };
}

export async function plainText(opts: { tier: keyof typeof MODELS; system: string; content: ResponseInputContent[] }): Promise<string> {
  const res = await getClient().responses.create({
    model: MODELS[opts.tier],
    instructions: opts.system,
    input: [{ role: "user", content: opts.content }],
    max_output_tokens: 16000,
  });
  if (res.status !== "completed") throw new Error(`Model returned status "${res.status}"`);
  return res.output_text;
}
