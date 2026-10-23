export type TaskResultFormat = { kind: "table"; columns: string[] };

function invalid(): never {
  throw new Error("task_result_format_invalid");
}

/** A saved layout request grants no execution permission or factual authority. */
export function parseTaskResultFormat(input: unknown): TaskResultFormat | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object" || Array.isArray(input)) return invalid();
  const keys = Reflect.ownKeys(input);
  if (keys.length !== 2 || !keys.includes("kind") || !keys.includes("columns"))
    return invalid();
  const fields = Object.getOwnPropertyDescriptors(input);
  if (
    !fields.kind ||
    !("value" in fields.kind) ||
    fields.kind.value !== "table" ||
    !fields.columns ||
    !("value" in fields.columns)
  )
    return invalid();
  const raw: unknown = fields.columns.value;
  if (
    !Array.isArray(raw) ||
    raw.length < 2 ||
    raw.length > 8 ||
    Reflect.ownKeys(raw).length !== raw.length + 1
  )
    return invalid();
  const columns: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index++) {
    const field = Object.getOwnPropertyDescriptor(raw, String(index));
    if (!field || !("value" in field)) return invalid();
    const value: unknown = field.value;
    if (
      typeof value !== "string" ||
      !value ||
      value.length > 80 ||
      value.trim() !== value ||
      /[\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(value) ||
      seen.has(value)
    )
      return invalid();
    columns.push(value);
    seen.add(value);
  }
  return { kind: "table", columns };
}
