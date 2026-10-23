import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LocalModelPreparationReceipt } from "@workspace/api-client-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";
import {
  preparationActive,
  readModelPreparation,
  readModelPreparationReceipt,
  startModelPreparation,
  stopModelPreparation,
} from "@/lib/local-model-preparation-api";
import type { ModelPreparationCopy } from "@/lib/local-model-preparation-copy";

export interface ModelPreparationProps {
  revision: number | null;
  confirmed: boolean;
  catalogReady: boolean;
  onActiveChange(active: boolean): void;
  onReadyChange(available: boolean): void;
  onRefresh(): Promise<void>;
  onReturn(): void;
}

// Retain an unacknowledged identity while the dialog is closed. Accepted work
// is recovered from durable receipts; this contains no address or credentials.
let pendingStartId: string | null = null;

export default function LocalModelPreparation({
  c,
  revision,
  confirmed,
  catalogReady,
  onActiveChange,
  onReadyChange,
  onRefresh,
  onReturn,
}: ModelPreparationProps & { c: ModelPreparationCopy }) {
  const { locale, t } = useLocale();
  const client = useQueryClient();
  const [requestId, setRequestId] = useState<string | null>(
    () => pendingStartId,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<"unknown" | null>(() =>
    pendingStartId ? "unknown" : null,
  );
  const guard = useRef(false);
  const checkedTerminal = useRef<string | null>(null);
  const snapshotKey = ["local-model-preparation", revision] as const;
  const snapshot = useQuery({
    queryKey: snapshotKey,
    queryFn: ({ signal }) => readModelPreparation(signal),
    retry: false,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const id = requestId ?? snapshot.data?.preparation?.requestId ?? null;
  const receiptKey = ["local-model-preparation-receipt", id] as const;
  const current = useQuery({
    queryKey: receiptKey,
    queryFn: ({ signal }) => readModelPreparationReceipt(id!, signal),
    enabled: Boolean(id),
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (query) =>
      !query.state.error && preparationActive(query.state.data) ? 1_000 : false,
  });
  const receipt =
    current.data ??
    (snapshot.data?.preparation?.requestId === id
      ? snapshot.data.preparation
      : null);
  const active = preparationActive(receipt);
  useEffect(() => {
    onActiveChange(
      active || busy || snapshot.isPending || Boolean(notice && id),
    );
  }, [active, busy, snapshot.isPending, notice, id, onActiveChange]);
  useEffect(() => () => onActiveChange(false), [onActiveChange]);
  useEffect(() => {
    if (
      receipt &&
      !preparationActive(receipt) &&
      checkedTerminal.current !== receipt.requestId
    ) {
      checkedTerminal.current = receipt.requestId;
      void snapshot.refetch();
    }
  }, [receipt, snapshot.refetch]);
  const remember = (value: LocalModelPreparationReceipt, intentId: string) => {
    if (pendingStartId === intentId) pendingStartId = null;
    setNotice(null);
    setRequestId(value.requestId);
    client.setQueryData(
      ["local-model-preparation-receipt", value.requestId],
      value,
    );
  };
  const start = async () => {
    if (guard.current || !canDownload || revision === null) return;
    guard.current = true;
    setBusy(true);
    setNotice(null);
    const input = {
      requestId: crypto.randomUUID(),
      expectedRevision: revision,
      modelId: "qwen35-2b" as const,
    };
    pendingStartId = input.requestId;
    setRequestId(input.requestId);
    try {
      remember(await startModelPreparation(input), input.requestId);
    } catch {
      setNotice("unknown");
      try {
        remember(
          await readModelPreparationReceipt(input.requestId),
          input.requestId,
        );
      } catch {
        /* Unknown stays blocked until a read or explicit stop settles it. */
      }
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  const stop = async () => {
    if (guard.current || !id) return;
    guard.current = true;
    setBusy(true);
    try {
      remember(await stopModelPreparation(id), id);
    } catch {
      setNotice("unknown");
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  const check = async () => {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    try {
      await onRefresh();
      await snapshot.refetch();
      if (id) {
        const result = await current.refetch();
        if (result.data && !result.isError) remember(result.data, id);
      }
    } finally {
      guard.current = false;
      setBusy(false);
    }
  };
  const server = snapshot.data?.availability.server;
  const changed = snapshot.data && snapshot.data.revision !== revision;
  const verified = !changed && confirmed && !snapshot.isError;
  const available =
    verified &&
    server === "compatible" &&
    Boolean(snapshot.data?.availability.available);
  const showPreparation =
    active ||
    id !== null ||
    !(
      verified &&
      catalogReady &&
      ["compatible", "update_required"].includes(server ?? "")
    );
  useLayoutEffect(() => {
    onReadyChange(available && showPreparation);
    return () => onReadyChange(false);
  }, [available, showPreparation, onReadyChange]);
  const canDownload =
    confirmed &&
    !changed &&
    !busy &&
    !notice &&
    !current.isError &&
    !active &&
    !snapshot.isPending &&
    !snapshot.isError &&
    server === "compatible";
  const phase =
    receipt?.state === "stopping"
      ? c.stopping
      : receipt?.phase === "checking" || receipt?.state === "verifying"
        ? c.checking
        : receipt?.phase === "preparing" || receipt?.state === "requested"
          ? c.preparing
          : c.downloading;
  const bytes = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "byte",
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const issue =
    changed || receipt?.failureCode === "CONFIG_CHANGED"
      ? c.changed
      : receipt?.failureCode === "RUNTIME_UPDATE_REQUIRED" ||
          server === "update_required"
        ? c.update
        : notice || current.isError
          ? c.unknown
          : snapshot.isError || receipt?.state === "failed"
            ? c.failed
            : receipt?.state === "interrupted"
              ? c.interrupted
              : !snapshot.isPending && server !== "compatible"
                ? c.unavailable
                : null;
  if (!showPreparation) return null;
  return (
    <section
      className="min-w-0 space-y-3 border-b pb-4"
      aria-busy={busy}
      aria-label={c.title}
    >
      <h4 className="text-base font-semibold">{c.title}</h4>
      <p className="text-sm leading-6 text-muted-foreground">{c.description}</p>
      <p className="text-sm font-medium [overflow-wrap:anywhere]">
        <bdi dir="ltr">qwen3.5:2b-q4_K_M</bdi>
      </p>
      {snapshot.isPending ? (
        <p role="status" className="text-sm">
          {t("providerSetupChecking")}
        </p>
      ) : null}
      {active ? (
        <div role="status" className="space-y-2 text-sm leading-6">
          <p className="font-medium">{phase}</p>
          <p>
            {c.bytes}:{" "}
            <bdi>
              {bytes.format(receipt!.observedCompletedBytes)} /{" "}
              {bytes.format(receipt!.observedTotalBytes)}
            </bdi>
          </p>
          {receipt?.progressReset ? <p>{c.reset}</p> : null}
          <p className="text-muted-foreground">{c.continues}</p>
        </div>
      ) : available ? (
        <div role="status" className="space-y-2 text-sm leading-6">
          <p className="font-medium">{c.available}</p>
          <p className="text-muted-foreground">{c.readyHint}</p>
        </div>
      ) : (
        <p className="text-sm leading-6 text-muted-foreground">{c.storage}</p>
      )}
      {!active && !available ? (
        <p className="text-sm leading-6 text-muted-foreground">
          {c.pendingHint}
        </p>
      ) : null}
      {issue && !available ? (
        <p
          role={
            notice ||
            current.isError ||
            snapshot.isError ||
            receipt?.state === "failed"
              ? "alert"
              : undefined
          }
          className="text-sm leading-6"
        >
          {issue}
        </p>
      ) : null}
      {!confirmed && !active ? (
        <p className="text-sm leading-6">{c.saveFirst}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {available && !active ? (
          <Button
            type="button"
            size="touch"
            disabled={busy}
            onClick={() => {
              void (async () => {
                setBusy(true);
                try {
                  await onRefresh();
                  onReturn();
                } catch {
                  setNotice("unknown");
                } finally {
                  setBusy(false);
                }
              })();
            }}
          >
            {c.returnToJob}
          </Button>
        ) : (
          <Button
            type="button"
            size="touch"
            disabled={!canDownload}
            onClick={() => void start()}
          >
            {c.download}
          </Button>
        )}
        {active || (notice && id) ? (
          <Button
            type="button"
            variant="outline"
            size="touch"
            disabled={busy || receipt?.state === "stopping"}
            onClick={() => void stop()}
          >
            {c.stop}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="touch"
          disabled={busy || snapshot.isFetching || current.isFetching}
          onClick={() => void check()}
        >
          {c.check}
        </Button>
      </div>
      {!active && !available ? (
        <details
          open={server !== undefined && server !== "compatible"}
          className="text-sm leading-6"
        >
          <summary className="min-h-11 cursor-pointer py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">
            {c.install}
          </summary>
          <p className="my-2 text-muted-foreground">{c.where}</p>
          <div className="flex flex-wrap gap-2">
            {[
              ["Windows", "windows"],
              ["macOS", "macos"],
              ["Linux", "linux"],
            ].map(([name, path]) => (
              <Button asChild key={path} variant="outline" size="touch">
                <a
                  href={`https://docs.ollama.com/${path}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <bdi dir="ltr">{name}</bdi>
                </a>
              </Button>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}
