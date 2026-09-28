import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  cancelTask,
  getTask,
  getListTasksQueryKey,
  getListTaskActivityQueryKey,
  type Task,
} from "@workspace/api-client-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import { type ProjectStudioCopy, studioText } from "@/lib/project-studio-copy";
import { taskStatusLabel } from "@/lib/format";

const terminal = (task: Task) =>
  ["completed", "failed", "cancelled"].includes(task.status);

/** A local uncertainty marker, not a server receipt. GET never replays a stop. */
export function ProjectStopControl({
  task,
  c,
  canStart,
  onObserved,
  onClosed,
}: {
  task: Task;
  c: ProjectStudioCopy;
  canStart: boolean;
  onObserved: (task: Task) => void;
  onClosed: () => void;
}) {
  const { locale } = useLocale();
  const cache = useQueryClient();
  const key = `acos.project-stop.v1:${task.id}`;
  const [uncertain, setUncertain] = useState(() => {
    try {
      return sessionStorage.getItem(key) !== null;
    } catch {
      return true;
    }
  });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<"send" | "check" | null>(null);
  const [checkedActive, setCheckedActive] = useState(false);
  const [notice, setNotice] = useState<
    "storage" | "stopped" | Task["status"] | null
  >(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const clearMarker = (expected: string | null) => {
    try {
      if (sessionStorage.getItem(key) === expected)
        sessionStorage.removeItem(key);
    } catch {
      /* Retain uncertainty across reload. */
    }
  };
  const refreshRelated = () => {
    void cache.invalidateQueries({ queryKey: getListTasksQueryKey() });
    void cache.invalidateQueries({
      queryKey: getListTaskActivityQueryKey(task.id),
    });
  };
  const stop = async () => {
    if (
      lock.current ||
      !canStart ||
      !alive.current ||
      document.visibilityState !== "visible"
    )
      return;
    lock.current = true;
    let marker: string;
    try {
      marker = JSON.stringify({
        taskId: task.id,
        requestNote: crypto.randomUUID(),
        sentAt: new Date().toISOString(),
      });
      sessionStorage.setItem(key, marker);
      if (sessionStorage.getItem(key) !== marker)
        throw new Error("Storage unavailable");
    } catch {
      lock.current = false;
      setNotice("storage");
      return;
    }
    setBusy("send");
    setNotice(null);
    setUncertain(true);
    setCheckedActive(false);
    try {
      const result = await cancelTask(task.id, {
        signal: AbortSignal.timeout(30_000),
      });
      if (result.id !== task.id || result.status !== "cancelled")
        throw new Error("Unconfirmed stop");
      clearMarker(marker);
      refreshRelated();
      if (alive.current) {
        onObserved(result);
        setUncertain(false);
        setNotice("stopped");
        setOpen(false);
      }
    } catch {
      // HTTP errors, lost acknowledgement and an aborted wait do not prove rollback.
      if (alive.current) setUncertain(true);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  };
  const check = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy("check");
    setCheckedActive(false);
    setNotice(null);
    let marker: string | null = null;
    try {
      marker = sessionStorage.getItem(key);
    } catch {
      /* GET remains available. */
    }
    try {
      const result = await getTask(task.id, {
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
      if (result.id !== task.id) throw new Error("Wrong project");
      if (alive.current) {
        onObserved(result);
        if (terminal(result)) {
          clearMarker(marker);
          setUncertain(false);
          setNotice(result.status);
          setOpen(false);
          refreshRelated();
        } else setCheckedActive(true);
      }
    } catch {
      if (alive.current) setUncertain(true);
    } finally {
      lock.current = false;
      if (alive.current) setBusy(null);
    }
  };
  const recovery = uncertain && busy !== "send";
  const status = (
    <div role="status" className="space-y-2 text-sm leading-6">
      {busy === "send" ? (
        <p>{c.stopping}</p>
      ) : recovery ? (
        <>
          <p className="font-semibold">{c.unknownStop}</p>
          <p>{checkedActive ? c.activeAfterCheck : c.unknownHelp}</p>
        </>
      ) : null}
      {notice && (
        <p>
          {notice === "storage"
            ? c.storageError
            : notice === "stopped"
              ? c.stopped
              : studioText(c.terminalObserved, {
                  status: taskStatusLabel(notice, locale),
                })}
        </p>
      )}
    </div>
  );
  return (
    <div className="min-w-0 basis-auto">
      {!open && (uncertain || notice) && (
        <div className="max-w-xl rounded-xl border bg-background p-3">
          {status}
          {recovery && (
            <Button
              className="mt-2 min-h-11"
              onClick={() => void check()}
              disabled={!!busy}
              aria-busy={busy === "check"}
            >
              {busy === "check" ? c.checking : c.checkState}
            </Button>
          )}
        </div>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        {(canStart || uncertain) && (
          <AlertDialogTrigger asChild>
            <Button
              ref={triggerRef}
              variant="ghost"
              className="min-h-11 whitespace-normal"
              disabled={!!busy || !canStart || (uncertain && !checkedActive)}
            >
              {uncertain ? c.reviewStop : c.stop}
            </Button>
          </AlertDialogTrigger>
        )}
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            cancelRef.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            if (!triggerRef.current || triggerRef.current.disabled) {
              event.preventDefault();
              onClosed();
            }
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{c.stopTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {studioText(c.stopHelp, { title: task.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {status}
          <AlertDialogFooter>
            <AlertDialogCancel ref={cancelRef} className="min-h-11">
              {c.dismiss}
            </AlertDialogCancel>
            {recovery && !checkedActive ? (
              <Button
                className="min-h-11"
                onClick={() => void check()}
                disabled={!!busy}
                aria-busy={busy === "check"}
              >
                {busy === "check" ? c.checking : c.checkState}
              </Button>
            ) : (
              <Button
                variant="destructive"
                className="min-h-11 whitespace-normal"
                onClick={() => void stop()}
                disabled={!!busy || !canStart}
                aria-busy={busy === "send"}
              >
                {busy === "send" ? c.stopping : c.confirmStop}
              </Button>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
