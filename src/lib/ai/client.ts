import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

/**
 * Two tiers, as in the proposal: a fast model for high-volume CV parsing/scoring,
 * and a stronger model for question design, interview scoring and reports.
 */
export const MODELS = {
  fast: process.env.AI_MODEL_FAST || "claude-haiku-4-5",
  smart: process.env.AI_MODEL_SMART || "claude-opus-5",
} as const;

export const isDemoMode = () => process.env.AI_DEMO_MODE === "true";

export class AiConfigError extends Error {}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new AiConfigError("ANTHROPIC_API_KEY is not configured");
  }
  client ??= new Anthropic({ maxRetries: 4, timeout: 5 * 60_000 });
  return client;
}

export async function structured<S extends z.ZodType>(opts: {
  tier: keyof typeof MODELS;
  system: string;
  content: Anthropic.ContentBlockParam[] | string;
  schema: S;
  maxTokens?: number;
}): Promise<{ data: z.infer<S>; model: string }> {
  const model = MODELS[opts.tier];
  const res = await getClient().messages.parse({
    model,
    max_tokens: opts.maxTokens ?? 16000,
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
    output_config: {
      format: zodOutputFormat(opts.schema),
      // Effort is not supported on Haiku; the fast tier runs at its default.
      ...(opts.tier === "smart" ? { effort: "high" as const } : {}),
    },
  });
  if (res.stop_reason === "refusal") {
    throw new Error(`Model declined the request (${res.stop_details?.category ?? "unspecified"})`);
  }
  if (res.stop_reason === "max_tokens") throw new Error("Model output was truncated");
  if (!res.parsed_output) throw new Error("Model returned output that did not match the schema");
  return { data: res.parsed_output as z.infer<S>, model };
}

export async function plainText(opts: {
  tier: keyof typeof MODELS;
  system: string;
  content: Anthropic.ContentBlockParam[];
}): Promise<string> {
  const res = await getClient().messages.create({
    model: MODELS[opts.tier],
    max_tokens: 16000,
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
  });
  if (res.stop_reason === "refusal") throw new Error("Model declined the request");
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}
