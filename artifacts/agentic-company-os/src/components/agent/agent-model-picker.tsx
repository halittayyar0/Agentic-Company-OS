import { useEffect, useMemo, useState } from "react";
import {
  useGetModelCatalog,
  getGetModelCatalogQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/search-input";
import { cn } from "@/lib/utils";
import { PROVIDER_META } from "@/lib/format";
import { matchesModelSearch } from "@/lib/model-search";
import type { NewAgentCopy } from "@/lib/new-agent-copy";
import type { Locale } from "@/lib/i18n";

export function AgentModelPicker({
  value,
  onChange,
  onAvailabilityChange,
  copy,
  retryLabel,
  locale,
}: {
  value: string;
  onChange: (id: string) => void;
  onAvailabilityChange: (available: boolean) => void;
  copy: NewAgentCopy["model"];
  retryLabel: string;
  locale: Locale;
}) {
  const [query, setQuery] = useState("");
  const [visiblePerProvider, setVisiblePerProvider] = useState(40);
  const {
    data: catalog,
    isPending,
    isError,
    isFetching,
    refetch,
  } = useGetModelCatalog({
    query: { queryKey: getGetModelCatalogQueryKey(), staleTime: 60_000 },
  });
  const providerLabel = (id: string, fallback: string) =>
    id === "replit" ? copy.builtin : (PROVIDER_META[id]?.label ?? fallback);
  const matchingModels = useMemo(
    () =>
      (catalog?.models ?? []).filter((model) =>
        matchesModelSearch(
          {
            ...model,
            description: [
              model.description,
              copy.tiers[model.tier],
              model.id.endsWith(":free") ? copy.free : "",
              !model.supportsTools ? copy.noTools : "",
            ].join(" "),
          },
          query,
          locale,
        ),
      ),
    [catalog?.models, query, copy, locale],
  );
  const groups = (catalog?.providers ?? [])
    .map((provider) => ({
      ...provider,
      models: matchingModels.filter((model) => model.provider === provider.id),
    }))
    .filter((group) => group.models.length > 0);
  const selected = catalog?.models.find((model) => model.id === value);
  const available =
    !isError &&
    !isFetching &&
    Boolean(
      selected?.supportsTools &&
      catalog?.providers.some(
        (provider) => provider.id === selected.provider && provider.available,
      ),
    );
  useEffect(
    () => onAvailabilityChange(available),
    [available, onAvailabilityChange],
  );
  useEffect(() => () => onAvailabilityChange(false), [onAvailabilityChange]);
  useEffect(() => setVisiblePerProvider(40), [query]);
  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder={copy.placeholder}
          label={copy.search}
          className="min-w-0 flex-1"
        />
        {catalog && (
          <span className="text-xs tabular-nums text-muted-foreground">
            {copy.count}:{" "}
            {new Intl.NumberFormat(locale).format(matchingModels.length)}
          </span>
        )}
      </div>
      {isPending ? (
        <div
          className="shimmer h-28 rounded-control"
          role="status"
          aria-label={copy.loading}
        />
      ) : isError ? (
        <div
          className="rounded-control border border-attention/25 bg-attention/5 p-4 text-sm text-attention-foreground"
          role="alert"
        >
          <p>{catalog ? copy.stale : copy.error}</p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 min-h-11"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {retryLabel}
          </Button>
        </div>
      ) : null}
      {groups.map((group) => (
        <section
          key={group.id}
          aria-label={providerLabel(group.id, group.label)}
        >
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <h3 className="font-semibold">
              <bdi>{providerLabel(group.id, group.label)}</bdi>
            </h3>
            {!group.available && (
              <span className="rounded border border-attention/25 bg-attention/5 px-1.5 py-1 text-attention-foreground">
                {copy.connection}
              </span>
            )}
            <span className="ms-auto tabular-nums text-muted-foreground">
              {new Intl.NumberFormat(locale).format(group.models.length)}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.models.slice(0, visiblePerProvider).map((model) => {
              const reason = !group.available
                ? copy.connectReason
                : !model.supportsTools
                  ? copy.toolsReason
                  : undefined;
              return (
                <div
                  key={model.id}
                  className="min-w-0 rounded-control border border-border"
                >
                  <button
                    type="button"
                    disabled={Boolean(reason) || isError || isFetching}
                    aria-pressed={value === model.id}
                    onClick={() => onChange(model.id)}
                    className={cn(
                      "min-h-11 w-full rounded-control p-3 text-start transition-colors disabled:cursor-not-allowed",
                      value === model.id
                        ? "bg-accent ring-1 ring-inset ring-primary"
                        : "hover:bg-secondary/40",
                    )}
                  >
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      <bdi className="min-w-0 break-words text-sm font-semibold">
                        {model.label}
                      </bdi>
                      {model.isDefault && (
                        <span className="text-primary">{copy.default}</span>
                      )}
                      {model.id.endsWith(":free") && (
                        <span className="text-primary">{copy.free}</span>
                      )}
                      <span className="text-muted-foreground">
                        {copy.tiers[model.tier]}
                      </span>
                    </span>
                    <span
                      dir="ltr"
                      className="mt-2 block break-all font-mono text-xs text-muted-foreground"
                    >
                      {model.id}
                    </span>
                    {reason && (
                      <span className="mt-2 block text-xs leading-5 text-attention-foreground">
                        {reason}
                      </span>
                    )}
                  </button>
                  {model.description && (
                    <details className="px-3 pb-2 text-xs text-muted-foreground">
                      <summary className="flex min-h-11 cursor-pointer items-center">
                        {copy.sourceDescription}
                      </summary>
                      <p dir="auto" className="break-words pb-2 leading-5">
                        {model.description}
                      </p>
                    </details>
                  )}
                </div>
              );
            })}
          </div>
          {visiblePerProvider < group.models.length && (
            <Button
              type="button"
              variant="ghost"
              className="mt-2 min-h-11 h-auto w-full whitespace-normal text-xs"
              onClick={() => setVisiblePerProvider((current) => current + 80)}
            >
              {copy.showMore}
            </Button>
          )}
        </section>
      ))}
      {!isPending && !isError && matchingModels.length === 0 && (
        <div
          role="status"
          className="rounded-control border border-dashed border-border px-4 py-6 text-center"
        >
          <p className="text-sm font-semibold">
            {query ? copy.noMatch : copy.empty}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {query ? copy.noMatchHelp : copy.emptyHelp}
          </p>
        </div>
      )}
    </div>
  );
}
