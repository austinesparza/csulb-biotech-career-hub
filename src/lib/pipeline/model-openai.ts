import type { ExtractedField } from "./evidence";
import type { ExtractionModel } from "./worker";

const DEFAULT_BASE_URL = "http://127.0.0.1:20128/v1";
const DEFAULT_TIMEOUT_MS = 90_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

function isLocalEndpoint(url: URL): boolean {
  return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
}

function requiredText(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} is required`);
  return trimmed;
}

function parseAssistantContent(content: unknown, requiredFields: string[]): Record<string, ExtractedField> {
  let parsed: unknown = content;
  if (typeof content === "string") parsed = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("model returned no structured extraction object");
  }
  for (const [name, field] of Object.entries(parsed)) {
    if (!field || typeof field !== "object" || Array.isArray(field)) {
      throw new Error(`model field ${name} is not an object`);
    }
    const value = (field as Record<string, unknown>).value;
    const quote = (field as Record<string, unknown>).quote;
    if (typeof value !== "string" || (quote !== null && typeof quote !== "string")) {
      throw new Error(`model field ${name} has an invalid value or quote`);
    }
  }
  for (const name of requiredFields) {
    if (!(name in parsed)) throw new Error(`model omitted required field ${name}`);
  }
  return parsed as Record<string, ExtractedField>;
}

export function createOpenAiCompatibleExtractionModel(options: {
  model: string;
  baseUrl?: string;
  apiKey?: string;
  allowRemote?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): ExtractionModel {
  const model = requiredText(options.model, "model");
  const baseUrl = new URL((options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "") + "/");
  if (!isLocalEndpoint(baseUrl) && !options.allowRemote) {
    throw new Error("remote model gateways are disabled; set allowRemote only after a privacy and retention review");
  }
  const fetchFn = options.fetch ?? fetch;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const endpoint = new URL("chat/completions", baseUrl).toString();
  const apiKey = options.apiKey?.trim();

  return {
    name: `openai-compatible:${model}`,
    async extract(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetchFn(endpoint, {
          method: "POST",
          redirect: "error",
          credentials: "omit",
          signal: controller.signal,
          headers: {
            "Content-Type": "application/json",
            "X-OmniRoute-Compression": "off",
            ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            messages: [
              { role: "system", content: input.system },
              { role: "user", content: input.user },
            ],
            response_format: {
              type: "json_schema",
              json_schema: input.schema,
            },
          }),
        });
        if (!response.ok) throw new Error(`model gateway failed with HTTP ${response.status}`);
        const declared = Number(response.headers.get("content-length") ?? 0);
        if (declared > MAX_RESPONSE_BYTES) throw new Error("model response is too large");
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("model response is too large");
        const payload = JSON.parse(text) as {
          choices?: Array<{ message?: { content?: unknown } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
          id?: string;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (content == null) throw new Error("model gateway returned no assistant content");
        return {
          fields: parseAssistantContent(content, input.schema.schema.required),
          inputTokens: payload.usage?.prompt_tokens,
          outputTokens: payload.usage?.completion_tokens,
          traceId: response.headers.get("x-request-id") ?? payload.id,
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
