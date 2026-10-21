import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { requireAnthropic } from "../config";

let client: Anthropic | null = null;
function anthropic() {
  requireAnthropic();
  client ??= new Anthropic();
  return client;
}

export class RefusalError extends Error {
  status = 422;
}

type Effort = "low" | "medium" | "high";

export type StructuredCall<T extends z.ZodType> = {
  model: string;
  schema: T;
  system: Anthropic.Beta.BetaTextBlockParam[];
  messages: Anthropic.Beta.BetaMessageParam[];
  effort?: Effort;
  maxTokens?: number;
  /** Server-side refusal fallback (Claude API, Sonnet/Opus tiers only). */
  fallback?: boolean;
};

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number };

/**
 * One Messages API call whose output is constrained to `schema` via structured
 * outputs. The SDK validates and parses the JSON; nothing is scraped from free text.
 */
export async function structuredCall<T extends z.ZodType>(
  call: StructuredCall<T>,
): Promise<{ data: z.infer<T>; usage: Usage }> {
  const useFallback = call.fallback && process.env.DISABLE_REFUSAL_FALLBACK !== "1";
  const response = await anthropic().beta.messages.parse({
    model: call.model,
    max_tokens: call.maxTokens ?? 16000,
    system: call.system,
    messages: call.messages,
    output_config: { effort: call.effort ?? "medium", format: betaZodOutputFormat(call.schema) },
    ...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
  });

  if (response.stop_reason === "refusal") {
    throw new RefusalError(
      "The model declined to answer this request. Please rephrase the question or contact the relevant office.",
    );
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The response was cut off before it finished. Try a narrower question.");
  }
  if (response.parsed_output == null) {
    throw new Error("The model returned an unparseable response.");
  }
  return {
    data: response.parsed_output as z.infer<T>,
    usage: {
      inputTokens:
        response.usage.input_tokens +
        (response.usage.cache_read_input_tokens ?? 0) +
        (response.usage.cache_creation_input_tokens ?? 0),
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
    },
  };
}
