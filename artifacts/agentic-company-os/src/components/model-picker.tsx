import { useMemo, useState } from "react";
import {
  Check,
  ChevronsUpDown,
  Cpu,
  Search,
  TriangleAlert,
  Zap,
} from "lucide-react";
import {
  getGetModelCatalogQueryKey,
  useGetModelCatalog,
} from "@workspace/api-client-react";
import type { ModelCatalogModel } from "@workspace/api-client-react";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PROVIDER_META } from "@/lib/format";
import {
  hasFreeModelIdentifier,
  matchesModelSearch,
  ollamaModelLocation,
} from "@/lib/model-search";
import { useLocale } from "@/components/i18n/locale-provider";
import {
  OllamaModelLocation,
  useOllamaLocationCopy,
} from "./agent/ollama-model-location";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { PulseDot, TierChip } from "@/components/fx";

export interface ModelSelectionValue {
  modelMode: "auto" | "manual";
  modelId: string | null;
}

export function describeSelection(
  value: ModelSelectionValue,
  catalog?: ModelCatalogModel[],
): { title: string; sub: string } {
  if (value.modelMode === "auto") {
    return {
      title: "Otomatik Yönlendirme",
      sub: "İş yüküne göre akıllı seçim",
    };
  }
  const hit = catalog?.find((m) => m.id === value.modelId);
  if (!hit) return { title: value.modelId ?? "?", sub: "Özel model" };
  const provider = PROVIDER_META[hit.provider]?.short ?? hit.provider;
  return { title: hit.label, sub: provider };
}

const MAX_PER_GROUP = 60;

export function ModelPicker({
  value,
  onChange,
  className,
  disabled = false,
}: {
  value: ModelSelectionValue;
  onChange: (next: ModelSelectionValue) => void;
  className?: string;
  disabled?: boolean;
}) {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedProviders, setExpandedProviders] = useState<
    Record<string, boolean>
  >({});

  const {
    data: catalogData,
    isLoading,
    isError,
    refetch,
  } = useGetModelCatalog({
    query: { staleTime: 30_000, queryKey: getGetModelCatalogQueryKey() },
  });
  const models = catalogData?.models ?? [];
  const needsLocationCopy = models.some(
    (model) => ollamaModelLocation(model) !== null,
  );
  const locationCopy = useOllamaLocationCopy(locale, needsLocationCopy);
  const providers = catalogData?.providers ?? [];

  const current = useMemo(
    () => describeSelection(value, models),
    [value, models],
  );
  const currentModel = useMemo(
    () => models.find((model) => model.id === value.modelId),
    [models, value.modelId],
  );

  // Search filters the full live list; groups collapse when empty.
  const filtered = useMemo(() => {
    return models.filter((model) => matchesModelSearch(model, search));
  }, [models, search]);

  const grouped = useMemo(() => {
    return providers
      .map((p) => ({
        ...p,
        models: filtered.filter((m) => m.provider === p.id),
      }))
      .filter((g) => g.models.length > 0);
  }, [providers, filtered]);

  const availableProviderCount = providers.filter(
    (provider) => provider.available,
  ).length;

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Ajan modelini seç"
          size="sm"
          disabled={disabled}
          className={cn(
            "group h-9 gap-2 border-border/80 bg-secondary/40 px-3 font-medium hover:border-primary/50 hover:bg-secondary",
            className,
          )}
        >
          <Cpu size={14} className="text-primary" />
          <span className="max-w-[150px] truncate text-[13px]">
            {current.title}
          </span>
          {currentModel?.supportsTools === false && (
            <TriangleAlert
              size={13}
              className="shrink-0 text-amber-300"
              aria-label="Seçili model ajan araçlarını desteklemiyor"
            />
          )}
          <ChevronsUpDown
            size={13}
            className="ml-auto text-muted-foreground transition-colors group-hover:text-foreground"
          />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-[min(380px,calc(100vw-2rem))] p-0"
      >
        <Command shouldFilter={false}>
          {/* arama — 300+ canlı modelde hayati */}
          <div className="flex items-center gap-2 border-b border-border px-3 pt-3 pb-2">
            <Search size={14} className="shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Model ara (isim, sağlayıcı, id)…"
              aria-label="Model kataloğunda ara"
              className="h-8 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/50"
            />
            <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground/60">
              {models.length} model · {availableProviderCount} hazır
            </span>
          </div>

          <CommandList className="max-h-[420px]">
            {needsLocationCopy && !locationCopy.data ? (
              <LanguagePackStatus
                error={locationCopy.isError}
                buttonClassName="min-h-11"
              />
            ) : null}
            {isLoading ? (
              <div
                className="py-6 text-center text-sm text-muted-foreground"
                role="status"
              >
                Model kataloğu yükleniyor…
              </div>
            ) : isError ? (
              <div className="px-4 py-6 text-center" role="alert">
                <p className="text-sm text-rose-300">
                  Model kataloğu yüklenemedi.
                </p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-2 text-xs font-semibold text-primary underline underline-offset-2"
                >
                  Yeniden dene
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                Eşleşen model yok.
              </div>
            ) : (
              <>
                {/* Otomatik her zaman en üstte */}
                <CommandGroup>
                  <CommandItem
                    value="__auto__"
                    onSelect={() => {
                      onChange({ modelMode: "auto", modelId: null });
                      setOpen(false);
                    }}
                    className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2"
                  >
                    <Zap size={14} className="mt-0.5 shrink-0 text-amber-300" />
                    <div className="flex min-w-0 flex-col">
                      <span className="text-sm font-semibold">
                        Otomatik Yönlendirme
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        Filo iş yüküne göre en uygun modeli seçer
                      </span>
                    </div>
                    <Check
                      size={15}
                      className={cn(
                        "ml-auto shrink-0 text-primary",
                        value.modelMode === "auto"
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                  </CommandItem>
                </CommandGroup>

                {grouped.map((group) => {
                  const expanded = Boolean(expandedProviders[group.id]);
                  const visible =
                    search.trim() || expanded
                      ? group.models
                      : group.models.slice(0, MAX_PER_GROUP);
                  const hiddenCount = group.models.length - visible.length;
                  return (
                    <div key={group.id}>
                      <div className="flex items-center gap-2 bg-secondary/40 px-3 py-1.5 text-[12px] font-bold uppercase tracking-widest text-muted-foreground">
                        <PulseDot
                          className={
                            group.available
                              ? (PROVIDER_META[group.id]?.dotClass ??
                                "bg-emerald-400")
                              : "bg-zinc-600"
                          }
                          pulse={group.available}
                        />
                        {PROVIDER_META[group.id]?.label ?? group.label}
                        {!group.available && (
                          <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1 py-px text-[12px] font-semibold uppercase text-amber-300 normal-case">
                            <TriangleAlert
                              size={10}
                              className="mr-0.5 inline"
                            />{" "}
                            anahtar gerekli
                          </span>
                        )}
                        <span className="ml-auto font-mono normal-case">
                          {group.models.length}
                        </span>
                      </div>

                      {visible.map((model) => {
                        const canRunAgentTools = model.supportsTools;
                        const unavailableReason = !group.available
                          ? "Bu sağlayıcı için API anahtarı gerekli"
                          : !canRunAgentTools
                            ? "Bu model ajan araçlarını desteklemiyor; yalnız sohbet için kullanılabilir"
                            : undefined;

                        return (
                          <CommandItem
                            key={model.id}
                            value={model.id}
                            disabled={
                              (ollamaModelLocation(model) !== null &&
                                !locationCopy.data) ||
                              !group.available ||
                              !canRunAgentTools ||
                              ollamaModelLocation(model) === "unknown"
                            }
                            title={unavailableReason}
                            onSelect={() => {
                              onChange({
                                modelMode: "manual",
                                modelId: model.id,
                              });
                              setOpen(false);
                            }}
                            className={cn(
                              "cursor-pointer gap-2 rounded-lg px-2.5 py-2",
                              (!group.available || !canRunAgentTools) &&
                                "cursor-not-allowed opacity-45",
                            )}
                          >
                            <Check
                              size={14}
                              className={cn(
                                "shrink-0 text-primary",
                                value.modelId === model.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="min-w-0 truncate text-[13px] font-semibold">
                                  {model.label}
                                </span>
                                <TierChip tier={model.tier} />
                                {model.isDefault && (
                                  <span className="shrink-0 rounded bg-primary/15 px-1 py-px text-[12px] font-bold uppercase text-primary">
                                    varsayılan
                                  </span>
                                )}
                                {hasFreeModelIdentifier(model) && (
                                  <span className="shrink-0 rounded border border-emerald-400/30 bg-emerald-500/10 px-1 py-px text-[12px] font-bold uppercase text-emerald-300">
                                    ücretsiz
                                  </span>
                                )}
                                {!canRunAgentTools && (
                                  <span className="shrink-0 rounded border border-amber-400/30 bg-amber-500/10 px-1 py-px text-[12px] font-bold uppercase text-amber-200">
                                    araç yok · yalnız sohbet
                                  </span>
                                )}
                                <OllamaModelLocation
                                  model={model}
                                  locale={locale}
                                />
                              </div>
                              <span className="line-clamp-1 text-[12px] text-muted-foreground">
                                {model.description}
                              </span>
                              <span className="font-mono text-[12px] text-muted-foreground/50">
                                {model.id}
                              </span>
                            </div>
                          </CommandItem>
                        );
                      })}

                      {!search.trim() &&
                        group.models.length > MAX_PER_GROUP && (
                          <button
                            type="button"
                            aria-expanded={expanded}
                            onClick={() =>
                              setExpandedProviders((current) => ({
                                ...current,
                                [group.id]: !expanded,
                              }))
                            }
                            className="w-full border-t border-border/50 px-3 py-2 text-left text-[12px] font-semibold text-primary/80 transition-colors hover:bg-primary/[0.04] hover:text-primary"
                          >
                            {expanded
                              ? "Daha az göster"
                              : `Tüm ${group.models.length} modeli göster (+${hiddenCount})`}
                          </button>
                        )}
                    </div>
                  );
                })}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
