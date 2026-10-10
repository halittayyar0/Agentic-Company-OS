export interface SearchableModel {
  id: string;
  label: string;
  description: string;
  provider: string;
  tier: string;
  supportsTools: boolean;
  executionLocation?: "local" | "cloud" | "unknown";
}

export function hasFreeModelIdentifier(
  model: Pick<SearchableModel, "id" | "provider">,
): boolean {
  return (
    model.provider !== "ollama" &&
    !model.id.startsWith("ollama:") &&
    !model.id.startsWith("ollama-cloud:") &&
    model.id.endsWith(":free")
  );
}

export function ollamaModelLocation(
  model: Pick<SearchableModel, "id" | "provider" | "executionLocation">,
): "local" | "cloud" | "unknown" | null {
  if (model.provider !== "ollama") return null;
  if (model.executionLocation === "local" && model.id.startsWith("ollama:"))
    return "local";
  if (
    model.executionLocation === "cloud" &&
    model.id.startsWith("ollama-cloud:")
  )
    return "cloud";
  return "unknown";
}

/**
 * Human model searches should survive punctuation, accents, word order, and
 * provider suffix syntax. In particular, natural queries such as
 * "MiniMax M3 Free" must match the exact `minimax/minimax-m3:free` row.
 */
export function normalizeModelSearch(value: string, locale = "tr"): string {
  return value
    .toLocaleLowerCase(locale)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[ıـ]/gu, (char) => (char === "ı" ? "i" : ""))
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesModelSearch(
  model: SearchableModel,
  rawQuery: string,
  locale = "tr",
): boolean {
  const terms = normalizeModelSearch(rawQuery, locale)
    .split(" ")
    .filter(Boolean);
  if (terms.length === 0) return true;

  const aliases = hasFreeModelIdentifier(model)
    ? "free ücretsiz ucretsiz bedava"
    : "";
  const haystack = normalizeModelSearch(
    [
      model.id,
      model.label,
      model.description,
      model.provider,
      model.tier,
      model.supportsTools
        ? "ajan araçları tool tools"
        : "araç yok yalnız sohbet",
      aliases,
    ].join(" "),
    locale,
  );

  return terms.every((term) => haystack.includes(term));
}
