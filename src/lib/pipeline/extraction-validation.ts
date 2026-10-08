import type { ExtractedField } from "./evidence";

/** Enforce the structured-output contract even when a gateway ignores JSON schema. */
export function validateExtractionShape(content: unknown, requiredFields: string[]): Record<string, ExtractedField> {
  const parsed: unknown = typeof content === "string" ? JSON.parse(content) : content;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("model returned no structured extraction object");
  }
  const fields = parsed as Record<string, unknown>;
  for (const name of Object.keys(fields)) {
    if (!requiredFields.includes(name)) throw new Error(`model returned unexpected field ${name}`);
    const field = fields[name];
    if (!field || typeof field !== "object" || Array.isArray(field)) throw new Error(`model field ${name} is not an object`);
    const entry = field as Record<string, unknown>;
    if (Object.keys(entry).length !== 2 || !("value" in entry) || !("quote" in entry)
      || typeof entry.value !== "string" || !entry.value.trim()
      || (entry.quote !== null && typeof entry.quote !== "string")) {
      throw new Error(`model field ${name} has an invalid value or quote`);
    }
    if (entry.value === "Unknown" && entry.quote !== null) throw new Error(`model field ${name}: Unknown must have a null quote`);
  }
  for (const name of requiredFields) {
    if (!Object.hasOwn(fields, name)) throw new Error(`model omitted required field ${name}`);
  }
  return fields as Record<string, ExtractedField>;
}
