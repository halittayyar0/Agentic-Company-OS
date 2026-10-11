import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useLocale } from "@/components/i18n/locale-provider";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { Button } from "@/components/ui/button";
import { controlPlaneFetch } from "@/lib/auth";
import { loadCompletionRequirementsCopy } from "@/lib/completion-requirements-copy";
import { completionCatalogView } from "@/lib/completion-requirements-view";
import {
  canonicalCompletionRequirements,
  type CompletionRequirement,
} from "@/lib/completion-requirements-input";

export default function CompletionRequirementsChoice({
  value,
  onChange,
  onBlockedChange,
  onReload,
}: {
  value: CompletionRequirement[];
  onChange: (value: CompletionRequirement[]) => void;
  onBlockedChange: (blocked: boolean) => void;
  onReload: () => void;
}) {
  const { locale, t } = useLocale();
  const [open, setOpen] = useState(value.length > 0),
    [search, setSearch] = useState("");
  const copy = useQuery({
    queryKey: ["completion-requirements-copy", locale],
    queryFn: () => loadCompletionRequirementsCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const catalog = useQuery({
    queryKey: ["task-completion-tools"],
    queryFn: async () => {
      const result = completionCatalogView(
        await controlPlaneFetch<unknown>("/api/task-completion-tools", {
          method: "GET",
          signal: AbortSignal.timeout(20_000),
          cache: "no-store",
        }),
      );
      if (!result) throw Error("invalid_completion_catalog");
      return result;
    },
    enabled: open || value.length > 0,
    staleTime: 0,
    retry: false,
  });
  const available = new Set(catalog.data?.tools ?? []);
  const missing = value.filter((item) => !available.has(item.tool));
  const blocked =
    value.length > 0 &&
    (!copy.data ||
      catalog.isFetching ||
      catalog.isError ||
      !catalog.data ||
      missing.length > 0);
  useEffect(() => onBlockedChange(blocked), [blocked, onBlockedChange]);
  const c = copy.data;
  if (!c)
    return (
      <LanguagePackStatus
        error={copy.isError}
        className="mt-4"
        onRetry={onReload}
      />
    );
  const selected = new Set(value.map((item) => item.tool));
  const update = (tool: string, checked: boolean) =>
    onChange(
      canonicalCompletionRequirements(
        checked
          ? [...value, { kind: "tool_succeeded", tool }]
          : value.filter((item) => item.tool !== tool),
      ),
    );
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mt-4 min-w-0 rounded-panel border border-border bg-card [overflow-wrap:anywhere]"
    >
      <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        {c.title}{" "}
        <span className="font-normal text-muted-foreground">
          ({c.optional})
        </span>
        {value.length > 0 && (
          <span className="ms-2">
            {new Intl.NumberFormat(locale).format(value.length)}
          </span>
        )}
      </summary>
      {open && (
        <div className="space-y-3 border-t border-border p-4 text-sm leading-6">
          <p>{c.help}</p>
          <p className="text-muted-foreground">{c.permissionHelp}</p>
          {value.length > 0 && (
            <section aria-label={c.selected} className="space-y-2">
              <h3 className="font-semibold">{c.selected}</h3>
              {value.map((item) => (
                <div
                  key={item.tool}
                  className="flex min-w-0 flex-wrap items-center gap-2 rounded-control border border-border p-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block">
                      {c.labels[item.tool] ?? c.other}
                    </span>
                    <bdi className="block text-xs text-muted-foreground">
                      {item.tool}
                    </bdi>
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 h-auto max-w-full whitespace-normal"
                    onClick={() => update(item.tool, false)}
                    aria-label={`${c.remove}: ${c.labels[item.tool] ?? item.tool}`}
                  >
                    {c.remove}
                  </Button>
                  {!catalog.isFetching &&
                    !catalog.isError &&
                    catalog.data &&
                    !available.has(item.tool) && (
                      <p className="w-full text-attention">{c.unavailable}</p>
                    )}
                </div>
              ))}
            </section>
          )}
          {catalog.isFetching ? (
            <p role="status">{c.loading}</p>
          ) : catalog.isError ? (
            <p role="alert">{c.loadError}</p>
          ) : catalog.data ? (
            <>
              <label className="block" htmlFor="completion-operation-search">
                {c.search}
              </label>
              <input
                id="completion-operation-search"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                className="min-h-11 w-full min-w-0 rounded-control border border-border bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              />
              <fieldset className="max-h-80 space-y-1 overflow-y-auto">
                <legend className="mb-2">{c.limit}</legend>
                {catalog.data.tools
                  .filter((tool) =>
                    `${c.labels[tool] ?? c.other} ${tool}`
                      .toLocaleLowerCase(locale)
                      .includes(search.toLocaleLowerCase(locale)),
                  )
                  .map((tool) => (
                    <label
                      key={tool}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-control p-2 hover:bg-muted focus-within:ring-2 focus-within:ring-primary"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(tool)}
                        disabled={!selected.has(tool) && selected.size >= 8}
                        onChange={(event) => update(tool, event.target.checked)}
                        className="h-4 w-4 shrink-0 accent-primary"
                      />
                      <span className="min-w-0">
                        <span className="block">
                          {c.labels[tool] ?? c.other}
                        </span>
                        <bdi className="block text-xs text-muted-foreground">
                          {tool}
                        </bdi>
                      </span>
                    </label>
                  ))}
                {!catalog.data.tools.length && <p>{c.empty}</p>}
              </fieldset>
            </>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11 h-auto max-w-full whitespace-normal"
              disabled={catalog.isFetching}
              onClick={() => void catalog.refetch()}
            >
              {c.retry}
            </Button>
            <Link
              href="/settings"
              className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4"
            >
              {t("settings")}
            </Link>
          </div>
        </div>
      )}
    </details>
  );
}
