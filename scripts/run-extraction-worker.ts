import { createOpenAiCompatibleExtractionModel } from "../src/lib/pipeline/model-openai";
import { runExtractionBatch } from "../src/lib/pipeline/extraction-runner";
import { createPipelineServiceClient, SupabaseExtractionStore } from "../src/lib/pipeline/store-supabase";

if (process.env.PIPELINE_MODEL_ENABLED !== "true") {
  throw new Error("Extraction is disabled. Set PIPELINE_MODEL_ENABLED=true only in an approved private worker environment.");
}

const baseUrl = process.env.PIPELINE_MODEL_BASE_URL ?? "http://127.0.0.1:20128/v1";
const allowRemote = process.env.PIPELINE_ALLOW_REMOTE_MODEL === "true";
const modelName = process.env.PIPELINE_MODEL_NAME?.trim();
if (!modelName) throw new Error("PIPELINE_MODEL_NAME is required");

const db = createPipelineServiceClient();
const store = new SupabaseExtractionStore(db);
const model = createOpenAiCompatibleExtractionModel({
  model: modelName,
  baseUrl,
  apiKey: process.env.PIPELINE_MODEL_API_KEY,
  allowRemote,
});
const limit = Number(process.env.PIPELINE_BATCH_LIMIT ?? 10);
const report = await runExtractionBatch({ store, model, limit });
console.log(JSON.stringify(report));
if (report.errors.length > 0) process.exitCode = 1;
