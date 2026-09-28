import { useEffect, useRef, useState } from "react";
import type { VmDeletionPreview, VmEntry } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { FileCopy } from "@/lib/file-copy";
import type { Locale } from "@/lib/i18n";
import {
  deleteReviewedScope,
  inspectFileDeletion,
  readDeletionRecord,
  writeDeletionRecord,
  type DeletionRecord,
} from "@/lib/file-deletion";

function readSaved(agentId: number) {
  try {
    return readDeletionRecord(agentId, window.sessionStorage);
  } catch {
    return { record: null, damaged: true };
  }
}
function save(agentId: number, record: DeletionRecord | null) {
  try {
    return writeDeletionRecord(agentId, record, window.sessionStorage);
  } catch {
    return false;
  }
}
function errorCode(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const value = error as { data?: { code?: unknown }; code?: unknown };
  return String(value.data?.code ?? value.code ?? "");
}

export function ReviewedFileDeletion({
  agentId,
  target,
  onClose,
  onChange,
  onReturnFocus,
  blocked,
  copy: c,
  locale,
}: {
  agentId: number;
  target: VmEntry | null;
  onClose: () => void;
  onChange: () => void;
  onReturnFocus: () => void;
  blocked: boolean;
  copy: FileCopy;
  locale: Locale;
}) {
  const [initial] = useState(() => readSaved(agentId));
  const [record, setRecord] = useState(initial.record);
  const [damaged, setDamaged] = useState(initial.damaged);
  const [storageError, setStorageError] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [preview, setPreview] = useState<VmDeletionPreview | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [clearConfirmed, setClearConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const generation = useRef(0);
  const sending = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const removedTarget = useRef(false);
  const needsRecovery = Boolean(record || damaged);
  const open = Boolean(target || recoveryOpen);
  const path = record?.path ?? target?.path ?? null;
  const number = new Intl.NumberFormat(locale);
  useEffect(() => {
    generation.current++;
    setPreview(null);
    setInspectionError(null);
    setInspecting(false);
    setConfirmed(false);
    setClearConfirmed(false);
  }, [open, path]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );

  async function inspect() {
    if (!path || inspecting || busy) return;
    const sequence = ++generation.current;
    setInspecting(true);
    setPreview(null);
    setConfirmed(false);
    setInspectionError(null);
    try {
      const current = await inspectFileDeletion(agentId, path);
      if (generation.current === sequence) setPreview(current);
    } catch (error) {
      const code = errorCode(error);
      if (generation.current === sequence)
        setInspectionError(
          code === "VM_DELETE_MISSING"
            ? c.missing
            : code === "VM_DELETE_NOT_REVIEWABLE"
              ? c.limited
              : code === "VM_DELETE_CHANGED"
                ? c.changed
                : c.error,
        );
    } finally {
      if (generation.current === sequence) setInspecting(false);
    }
  }

  async function remove() {
    if (
      !preview ||
      !confirmed ||
      blocked ||
      needsRecovery ||
      storageError ||
      sending.current ||
      inspecting
    )
      return;
    const current = readSaved(agentId);
    if (current.damaged || current.record) {
      setRecord(current.record);
      setDamaged(current.damaged);
      setConfirmed(false);
      return;
    }
    const request: DeletionRecord = {
      id: crypto.randomUUID(),
      agentId,
      path: preview.path,
      expectedVersion: preview.version,
      startedAt: new Date().toISOString(),
      status: "pending",
    };
    if (!save(agentId, request)) {
      setStorageError(true);
      return;
    }
    setRecord(request);
    setBusy(true);
    sending.current = true;
    setSuccess(false);
    let removed = false;
    try {
      await deleteReviewedScope(agentId, {
        path: request.path,
        expectedVersion: request.expectedVersion,
      });
      removed = true;
    } catch {
      // Even a failed HTTP response can follow partial filesystem effects.
    }
    const latest = readSaved(agentId);
    if (!latest.damaged && latest.record?.id === request.id) {
      const next: DeletionRecord | null = removed
        ? null
        : { ...request, status: "unknown" };
      if (save(agentId, next)) {
        setRecord(next);
        if (removed) {
          removedTarget.current = true;
          setSuccess(true);
          onClose();
          setRecoveryOpen(false);
        }
      } else {
        setStorageError(true);
        setRecord({ ...request, status: "unknown" });
      }
    } else {
      setRecord(latest.record);
      setDamaged(latest.damaged);
      setStorageError(true);
    }
    setPreview(null);
    setConfirmed(false);
    setBusy(false);
    sending.current = false;
    onChange();
  }

  return (
    <>
      {success && (
        <p
          className="border-b bg-card p-3 text-sm text-foreground"
          role="status"
        >
          {c.success}
        </p>
      )}
      {needsRecovery && (
        <div
          className="space-y-2 border-b bg-card p-3 text-sm text-foreground"
          role="status"
        >
          <p>{busy ? c.pending : damaged ? c.damaged : c.unknown}</p>
          {record && (
            <p dir="auto" className="break-all font-mono">
              {record.path}
            </p>
          )}
          <Button
            className="min-h-11 whitespace-normal md:min-h-11"
            variant="outline"
            onClick={() => setRecoveryOpen(true)}
          >
            {c.recover}
          </Button>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value && !busy) {
            onClose();
            setRecoveryOpen(false);
          }
        }}
      >
        <DialogContent
          className="max-h-[90dvh] max-w-2xl overflow-y-auto"
          dir={locale === "ar" ? "rtl" : "ltr"}
          onOpenAutoFocus={() => {
            returnFocus.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
            removedTarget.current = false;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const origin = returnFocus.current;
            if (
              !removedTarget.current &&
              origin?.isConnected &&
              origin.offsetParent &&
              !origin.matches(":disabled")
            )
              origin.focus();
            else onReturnFocus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{c.title}</DialogTitle>
            <DialogDescription>{c.help}</DialogDescription>
          </DialogHeader>
          {path && (
            <p
              dir="auto"
              className="break-all whitespace-pre-wrap font-mono text-base"
            >
              {path}
            </p>
          )}
          <p className="text-sm text-muted-foreground">{c.localOnly}</p>
          {busy ? (
            <p role="status">{c.pending}</p>
          ) : (
            needsRecovery && (
              <section
                className="space-y-3 rounded-lg border p-3"
                aria-label={c.unknown}
              >
                <p className="text-sm" role="alert">
                  {damaged ? c.damaged : c.unknownHelp}
                </p>
                <label className="flex min-h-11 items-start gap-3 py-2 text-sm">
                  <input
                    className="mt-1 size-5 shrink-0"
                    type="checkbox"
                    checked={clearConfirmed}
                    onChange={(event) =>
                      setClearConfirmed(event.target.checked)
                    }
                  />
                  {c.clearConfirm}
                </label>
                <Button
                  className="min-h-11 whitespace-normal md:min-h-11"
                  variant="outline"
                  disabled={!clearConfirmed}
                  onClick={() => {
                    const current = readSaved(agentId);
                    if (
                      current.record?.id !== record?.id ||
                      current.damaged !== damaged
                    ) {
                      setRecord(current.record);
                      setDamaged(current.damaged);
                      setClearConfirmed(false);
                      return;
                    }
                    if (!save(agentId, null)) {
                      setStorageError(true);
                      return;
                    }
                    setRecord(null);
                    setDamaged(false);
                    setStorageError(false);
                    setPreview(null);
                    setConfirmed(false);
                    onClose();
                    setRecoveryOpen(false);
                    onChange();
                  }}
                >
                  {c.clear}
                </Button>
              </section>
            )
          )}
          {storageError && (
            <div role="alert" className="space-y-2 text-sm">
              <p>{c.storageError}</p>
              <Button
                variant="outline"
                className="min-h-11 whitespace-normal md:min-h-11"
                disabled={busy}
                onClick={() => {
                  const current = readSaved(agentId);
                  setRecord(current.record);
                  setDamaged(current.damaged);
                  if (!current.damaged)
                    setStorageError(!save(agentId, current.record));
                }}
              >
                {c.storageRetry}
              </Button>
            </div>
          )}
          {blocked && (
            <p className="text-sm" role="status">
              {c.blocked}
            </p>
          )}
          {path && (
            <Button
              variant="outline"
              className="min-h-11 whitespace-normal md:min-h-11"
              disabled={inspecting || busy || damaged}
              onClick={() => void inspect()}
            >
              {inspecting ? c.inspecting : c.inspect}
            </Button>
          )}
          {inspectionError && (
            <p role="alert" className="text-sm">
              {inspectionError}
            </p>
          )}
          {preview && (
            <section className="space-y-3" aria-label={c.scope}>
              <h3 className="font-medium">{c.scope}</h3>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-muted-foreground">{c.count}</dt>
                  <dd>{number.format(preview.entryCount)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{c.bytes}</dt>
                  <dd>{number.format(preview.totalBytes)}</dd>
                </div>
              </dl>
              <ul
                tabIndex={0}
                aria-label={c.scope}
                className="max-h-60 space-y-2 overflow-y-auto rounded-lg border p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              >
                {preview.entries.map((entry) => (
                  <li
                    key={entry.path}
                    className="space-y-1 border-b pb-2 text-sm last:border-b-0 last:pb-0"
                  >
                    <p
                      dir="auto"
                      className="break-all whitespace-pre-wrap font-mono"
                    >
                      {entry.path}
                    </p>
                    <p className="text-muted-foreground">
                      {entry.type === "file" ? c.file : c.folder}
                      {entry.type === "file" &&
                        ` · ${number.format(entry.sizeBytes)} ${c.bytes}`}
                    </p>
                  </li>
                ))}
              </ul>
              {!needsRecovery && (
                <label className="flex min-h-11 items-start gap-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 size-5 shrink-0"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  {c.confirm}
                </label>
              )}
            </section>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              className="min-h-11 whitespace-normal md:min-h-11"
              disabled={busy}
              onClick={() => {
                onClose();
                setRecoveryOpen(false);
              }}
            >
              {c.cancel}
            </Button>
            {!needsRecovery && (
              <Button
                variant="destructive"
                className="min-h-11 whitespace-normal md:min-h-11"
                disabled={
                  !preview ||
                  !confirmed ||
                  busy ||
                  blocked ||
                  storageError ||
                  inspecting
                }
                onClick={() => void remove()}
              >
                {c.submit}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
