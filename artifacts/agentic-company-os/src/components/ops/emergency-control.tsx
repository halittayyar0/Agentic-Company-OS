import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertOctagon, LoaderCircle, Play, RefreshCw } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/i18n/locale-provider";
import { useOpsControl } from "@/components/ops/ops-control-provider";
import {
  fallbackEmergencyControlCopy,
  loadEmergencyControlCopy,
} from "@/lib/emergency-control-copy";
import { cn } from "@/lib/utils";

function useEmergencyCopy() {
  const { locale } = useLocale();
  const copyQuery = useQuery({
    queryKey: ["emergency-control-copy", locale],
    queryFn: loadEmergencyControlCopy[locale],
    staleTime: Infinity,
    retry: 1,
  });
  // Safety controls remain operable if a language asset is unavailable.
  return copyQuery.data ?? fallbackEmergencyControlCopy;
}

export function EmergencyControl() {
  const copy = useEmergencyCopy();
  const { state, isLoading, isError, isUpdating, stop, resume, refetch } =
    useOpsControl();
  const [open, setOpen] = useState(false);
  const [intent, setIntent] = useState<"stop" | "resume" | null>(null);
  const [reason, setReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const active = Boolean(state?.emergencyStopEnabled);
  const selectedIntent = intent ?? (active ? "resume" : "stop");
  const resuming = selectedIntent === "resume";
  const normalizedReason = reason.trim();

  if (isLoading) {
    return (
      <span
        className="inline-flex size-11 items-center justify-center rounded-lg border border-border text-muted-foreground"
        role="status"
        aria-label={copy.checking}
      >
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
      </span>
    );
  }

  if (isError || !state) {
    return (
      <Button
        type="button"
        size="icon"
        variant="outline"
        onClick={refetch}
        aria-label={copy.retryLabel}
        title={copy.unavailable}
        className="size-11 border-attention-border/30 text-attention-foreground"
      >
        <RefreshCw className="size-4" />
      </Button>
    );
  }

  const runAction = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (isUpdating || (!resuming && normalizedReason.length < 3)) return;
    setActionError(null);
    try {
      if (resuming) await resume();
      else await stop(normalizedReason);
      setOpen(false);
      setIntent(null);
      setReason("");
    } catch {
      setActionError(copy.actionError);
    }
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (isUpdating) return;
        if (next) setIntent(active ? "resume" : "stop");
        setOpen(next);
        setActionError(null);
        if (!next) {
          setIntent(null);
          setReason("");
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            "min-h-11 min-w-11 border-destructive/35 px-2.5 text-foreground hover:bg-destructive/10 sm:px-3",
            active &&
              "border-verified-border/35 bg-verified/5 text-verified-foreground hover:bg-verified/10",
          )}
          aria-label={active ? copy.resumeLabel : copy.stop}
        >
          {active ? (
            <Play aria-hidden />
          ) : (
            <AlertOctagon className="text-destructive" aria-hidden />
          )}
          <span className="hidden xl:inline">
            {active ? copy.resume : copy.stop}
          </span>
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {resuming ? copy.resumeTitle : copy.stopTitle}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {resuming ? copy.resumeDescription : copy.stopDescription}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!resuming ? (
          <div className="space-y-2">
            <Label htmlFor="emergency-stop-reason">{copy.reason}</Label>
            <Textarea
              id="emergency-stop-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value.slice(0, 500))}
              placeholder={copy.reasonPlaceholder}
              required
              minLength={3}
              maxLength={500}
              autoFocus
              aria-describedby="emergency-stop-help"
            />
            <div
              id="emergency-stop-help"
              className="flex justify-between gap-3 text-[12px] text-muted-foreground"
            >
              <span>{copy.reasonHelp}</span>
              <span className="shrink-0">{reason.length}/500</span>
            </div>
          </div>
        ) : null}

        {actionError ? (
          <p
            role="alert"
            className="rounded-control border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground max-sm:px-[12px]"
          >
            {actionError}
          </p>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={isUpdating} className="min-h-11">
            {copy.cancel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={runAction}
            disabled={isUpdating || (!resuming && normalizedReason.length < 3)}
            className={cn(
              "min-h-11 whitespace-normal border",
              resuming
                ? "border-verified-border/40 bg-verified/10 text-verified-foreground hover:bg-verified/20"
                : "border-destructive/40 bg-destructive/10 text-foreground hover:bg-destructive/20",
            )}
          >
            {isUpdating ? (
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden
              />
            ) : resuming ? (
              <Play className="size-4" aria-hidden />
            ) : (
              <AlertOctagon className="size-4 text-destructive" aria-hidden />
            )}
            {isUpdating
              ? copy.applying
              : resuming
                ? copy.confirmResume
                : copy.confirmStop}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function EmergencyStopBanner() {
  const copy = useEmergencyCopy();
  const { state, isError, refetch } = useOpsControl();

  if (isError) {
    return (
      <div
        className="relative z-20 flex flex-wrap items-center justify-center gap-2 border-b border-attention-border/25 bg-attention/10 px-4 py-2 text-center text-xs font-semibold text-attention-foreground"
        role="alert"
      >
        <AlertOctagon className="size-4" aria-hidden />
        {copy.safetyUnknown}
        <button
          type="button"
          onClick={refetch}
          className="min-h-11 rounded px-2 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {copy.retry}
        </button>
      </div>
    );
  }

  if (!state?.emergencyStopEnabled) return null;
  return (
    <div
      className="relative z-20 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-center text-xs font-semibold text-foreground"
      role="alert"
    >
      <AlertOctagon className="size-4 text-destructive" aria-hidden />
      <span>{copy.stopActive}</span>
      {state.reason ? (
        <span
          className="min-w-0 font-normal [overflow-wrap:anywhere]"
          dir="auto"
        >
          {state.reason}
        </span>
      ) : null}
      <span
        className="min-w-0 font-mono text-[12px] text-muted-foreground [overflow-wrap:anywhere]"
        dir="auto"
      >
        {state.updatedBy}
      </span>
    </div>
  );
}
