import { useQuery } from "@tanstack/react-query";
import type { ModelCatalogModel } from "@workspace/api-client-react";
import {
  loadConnectionCopy,
  localModelRuntimeHint,
} from "@/lib/connection-copy";
import { ollamaModelLocation } from "@/lib/model-search";
import type { Locale } from "@/lib/i18n";

export function useOllamaLocationCopy(locale: Locale, enabled: boolean) {
  return useQuery({
    queryKey: ["connection-copy", locale],
    queryFn: () => loadConnectionCopy(locale),
    enabled,
    staleTime: Infinity,
    retry: false,
  });
}

/** Shared authored labels across connection, expert and advanced model choices. */
export function OllamaModelLocation({
  model,
  locale,
}: {
  model: ModelCatalogModel;
  locale: Locale;
}) {
  const location = ollamaModelLocation(model);
  const copy = useOllamaLocationCopy(locale, location !== null);
  if (!location || !copy.data) return null;
  const hint =
    location === "local" ? localModelRuntimeHint(model, copy.data) : null;
  return (
    <span className="inline-block max-w-full rounded border px-2 py-1 text-xs leading-5 text-muted-foreground [overflow-wrap:anywhere]">
      {
        copy.data[
          location === "local"
            ? "localLocation"
            : location === "cloud"
              ? "cloudLocation"
              : "unknownLocation"
        ]
      }
      {hint ? (
        <span className="block">
          {hint[0]}
          <bdi dir="ltr">{hint[1]}</bdi>
          {hint[2]}
        </span>
      ) : null}
    </span>
  );
}
