import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getGetProjectOperationsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, useController } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, Loader2, ShieldCheck } from "lucide-react";
import { useToast } from "../../hooks/use-toast";
import { ControlPlaneError } from "../../lib/auth";
import {
  dispatchOperationIntent,
  readOperationReceipt,
  type ExactOperationReview,
} from "../../lib/operation-recovery-api";
import {
  acknowledgeOperationIntent,
  discardOperationDraft,
  operationNoteBytes,
  prepareOperationIntent,
  readOperationDraft,
  readOperationDraftRaw,
  readOperationIntent,
  saveOperationDraft,
  OperationRecoveryError,
  type OperationIntent,
} from "../../lib/operation-recovery";
import type {
  AttemptEvidenceChain,
  OperationsReceiptInput,
} from "../../lib/operations-view-model";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { ValidatedForm } from "../ui/validated-form";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Textarea } from "../ui/textarea";
import { useOperationsCopy } from "./operations-copy-context";
import {
  createReceiptReconciliationSchema,
  type ReconciliationFormValues,
} from "./receipt-reconciliation-model";

type ReviewStatus =
  | ExactOperationReview
  | { kind: "uncertain" | "checkFailed" | "initial" | "missing" };

export function ReceiptReconciliationDialog({
  open,
  onOpenChange,
  project,
  receipt,
  chain,
  refreshFailed = false,
  receiptMissing = false,
  recoveryReceiptId,
  onRestoreFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: { id: number; title: string };
  receipt: OperationsReceiptInput | null;
  chain: AttemptEvidenceChain | null;
  refreshFailed?: boolean;
  receiptMissing?: boolean;
  recoveryReceiptId?: string;
  onRestoreFocus?: () => void;
}) {
  const { copy: c, t, number, time, state } = useOperationsCopy();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [review, setReview] = useState<ReviewStatus>({ kind: "initial" });
  const [submitted, setSubmitted] = useState<OperationIntent | null>(null);
  const submittedRef = useRef<OperationIntent | null>(null);
  const [localError, setLocalError] = useState<
    "storage" | "pending" | "invalid" | null
  >(null);
  const [damagedDraft, setDamagedDraft] = useState<string | null>(null);
  const [discardAccepted, setDiscardAccepted] = useState(false);
  const activeScope = useRef<string | null>(null);
  // Also keep unsaved text in memory if browser storage becomes unavailable.
  const drafts = useRef(
    new Map<
      string,
      {
        values: ReconciliationFormValues;
        review: ReviewStatus;
        submitted: OperationIntent | null;
        unsaved?: boolean;
      }
    >(),
  );
  const receiptId = recoveryReceiptId ?? receipt?.id ?? null;
  const key = receiptId ? `${project.id}:${receiptId}` : null;
  useLayoutEffect(() => {
    activeScope.current = open ? key : null;
    return () => {
      activeScope.current = null;
    };
  }, [open, key]);
  const schema = useMemo(
    () =>
      createReceiptReconciliationSchema({
        ...c,
        noteLong: t("noteLong", { count: number.format(2000) }),
      }),
    [c, t, number],
  );
  const form = useForm<ReconciliationFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { decision: "", note: "" },
    mode: "onTouched",
  });
  const decision = useController({ name: "decision", control: form.control });
  const note = useController({ name: "note", control: form.control });
  const fields = form.formState.errors;
  useEffect(() => {
    if (!open || !key || !receiptId) return;
    const saved = drafts.current.get(key);
    form.reset(saved?.values ?? { decision: "", note: "" });
    setReview(saved?.review ?? { kind: "initial" });
    submittedRef.current = saved?.submitted ?? null;
    setLocalError(null);
    setDamagedDraft(null);
    setDiscardAccepted(false);
    try {
      const intent = readOperationIntent(project.id);
      if (intent && intent.receiptId !== receiptId)
        throw new OperationRecoveryError("pending");
      // A successful storage read owns recovery identity, including explicit
      // clearing from the panel while this dialog was closed.
      submittedRef.current = intent;
      if (intent) {
        form.reset(intent);
        setReview({ kind: "uncertain" });
      } else {
        setReview({ kind: "initial" });
        form.reset({ decision: "", note: "" });
      }
      const raw = readOperationDraftRaw(project.id, receiptId);
      try {
        const draft = readOperationDraft(project.id, receiptId);
        if (!intent)
          form.reset(
            saved?.unsaved && !saved.submitted
              ? saved.values
              : (draft ?? { decision: "", note: "" }),
          );
      } catch (error) {
        if (error instanceof OperationRecoveryError && error.code === "invalid")
          setDamagedDraft(raw);
        throw error;
      }
    } catch (error) {
      setLocalError(
        error instanceof OperationRecoveryError ? error.code : "storage",
      );
    }
    setSubmitted(submittedRef.current);
  }, [open, key, receiptId, project.id, form]);

  const eligible =
    receipt?.state === "unknown" &&
    receipt.reconciliation.eligible &&
    receipt.reconciliation.decision === null;
  const blocked =
    (review.kind !== "eligible" && !eligible) ||
    receipt?.reconciliation.decision != null ||
    localError === "pending" ||
    localError === "invalid" ||
    (receiptMissing && review.kind !== "eligible") ||
    (refreshFailed && review.kind !== "eligible") ||
    !["initial", "eligible"].includes(review.kind);
  const busy = pending || checking;
  const saveDraft = (values: ReconciliationFormValues) => {
    if (!key || !receiptId || submittedRef.current) return;
    drafts.current.set(key, { values, review, submitted: null, unsaved: true });
    try {
      saveOperationDraft(project.id, receiptId, values);
      drafts.current.set(key, {
        values,
        review,
        submitted: null,
        unsaved: false,
      });
      setLocalError(null);
    } catch (error) {
      setLocalError(
        error instanceof OperationRecoveryError ? error.code : "storage",
      );
    }
  };
  const remember = (next: ReviewStatus) => {
    setReview(next);
    if (key)
      drafts.current.set(key, {
        unsaved: drafts.current.get(key)?.unsaved,
        values: form.getValues(),
        review: next,
        submitted: submittedRef.current,
      });
  };
  const requestOpenChange = (next: boolean) => {
    if (!next && lock.current) return;
    if (!next && key)
      drafts.current.set(key, {
        unsaved: drafts.current.get(key)?.unsaved,
        values: form.getValues(),
        review,
        submitted: submittedRef.current,
      });
    onOpenChange(next);
  };
  const refreshCache = () =>
    void queryClient.invalidateQueries({
      queryKey: getGetProjectOperationsQueryKey(project.id),
    });
  const checkRecord = async () => {
    if (!receiptId || lock.current) return;
    lock.current = true;
    setChecking(true);
    try {
      const next = await readOperationReceipt(project.id, receiptId);
      if (activeScope.current !== key) return;
      remember(next);
      // Cache monotonicity stays owned by the route's structural-sharing policy.
      refreshCache();
    } catch (error) {
      if (activeScope.current === key)
        remember({
          kind:
            error instanceof ControlPlaneError && error.status === 404
              ? "missing"
              : "checkFailed",
        });
    } finally {
      lock.current = false;
      setChecking(false);
    }
  };
  const submit = async (values: ReconciliationFormValues) => {
    if (!receiptId || blocked || lock.current || values.decision === "") return;
    lock.current = true;
    setPending(true);
    try {
      const intent =
        submittedRef.current ??
        prepareOperationIntent({
          projectId: project.id,
          receiptId,
          decision: values.decision,
          note: values.note,
        });
      submittedRef.current = intent;
      setSubmitted(intent);
      setLocalError(null);
      remember({ kind: "uncertain" });
      const result = await dispatchOperationIntent(intent);
      if (activeScope.current !== key) return;
      refreshCache();
      // Same-decision idempotency can return another operator's earlier note.
      if (result.note !== intent.note) {
        remember({
          kind: "recorded",
          decision: result.decision,
          audit: result,
        });
      } else {
        if (!acknowledgeOperationIntent(intent))
          throw new OperationRecoveryError("pending");
        if (key) drafts.current.delete(key);
        toast({
          title: c.saved,
          description:
            result.decision === "confirmed_applied"
              ? c.appliedRecord
              : c.notAppliedRecord,
        });
        form.reset({ decision: "", note: "" });
        onOpenChange(false);
      }
    } catch (error) {
      if (activeScope.current === key) {
        if (error instanceof OperationRecoveryError) setLocalError(error.code);
        if (submittedRef.current) remember({ kind: "uncertain" });
        queueMicrotask(() => saveRef.current?.focus());
      }
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  const acknowledge = () => {
    if (!submittedRef.current || review.kind !== "recorded") return;
    try {
      if (!acknowledgeOperationIntent(submittedRef.current))
        throw new OperationRecoveryError("pending");
      if (key) drafts.current.delete(key);
      onOpenChange(false);
    } catch (error) {
      setLocalError(
        error instanceof OperationRecoveryError ? error.code : "storage",
      );
    }
  };
  const boundary =
    receipt?.invocations
      .map((i) => i.effectStartedAt)
      .filter((v): v is string => v !== null)
      .sort()
      .at(-1) ?? null;
  const recorded = receipt?.reconciliation.decision;
  const status =
    review.kind === "recorded"
      ? t("recordConfirmed", {
          decision:
            review.decision === "confirmed_applied" ? c.applied : c.notApplied,
        })
      : recorded
        ? t("recordConfirmed", {
            decision:
              recorded === "confirmed_applied" ? c.applied : c.notApplied,
          })
        : review.kind === "uncertain"
          ? c.uncertain
          : review.kind === "checkFailed"
            ? c.checkFailed
            : review.kind === "missing" ||
                (receiptMissing && review.kind !== "eligible")
              ? c.recordMissing
              : review.kind === "eligible"
                ? c.recordFresh
                : !eligible || review.kind === "ineligible"
                  ? c.ineligible
                  : refreshFailed
                    ? c.staleWrite
                    : null;
  return (
    <AlertDialog open={open} onOpenChange={requestOpenChange}>
      <AlertDialogContent
        className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-panel border-border bg-card [overflow-wrap:anywhere] shadow-[var(--shadow-overlay)]"
        onEscapeKeyDown={(event) => {
          if (lock.current) event.preventDefault();
        }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (onRestoreFocus) {
            event.preventDefault();
            onRestoreFocus();
          }
        }}
      >
        <AlertDialogHeader>
          <div className="flex items-start gap-3 text-start">
            <ShieldCheck
              size={24}
              className="shrink-0 text-attention"
              aria-hidden
            />
            <div className="min-w-0">
              <AlertDialogTitle className="font-serif text-2xl">
                {c.reconcileTitle}
              </AlertDialogTitle>
              <AlertDialogDescription className="mt-2 text-sm leading-6">
                {c.reconcileHelp}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>
        {receipt && (
          <dl className="grid gap-px border bg-border text-xs sm:grid-cols-2">
            {[
              [c.project, `${project.title} · #${project.id}`],
              [c.logicalExecution, chain?.logicalExecutionId ?? c.noLink],
              [
                c.operation,
                `${receipt.toolName} · ${state(receipt.executionKind)}`,
              ],
              [c.receipt, receipt.id],
              [c.effectClass, state(receipt.sideEffectClass)],
              [
                c.lastBoundary,
                boundary ? time(boundary) : c.boundaryNotRecorded,
              ],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 bg-background p-3">
                <dt className="font-semibold text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-words [overflow-wrap:anywhere]">
                  <bdi>{value}</bdi>
                </dd>
              </div>
            ))}
          </dl>
        )}
        {!receipt && receiptId && (
          <p className="text-sm">
            <strong>{c.receipt}: </strong>
            <bdi>{receiptId}</bdi>
          </p>
        )}
        {damagedDraft !== null && (
          <section className="space-y-3 border p-3">
            <p className="text-sm">{c.damagedDraft}</p>
            <pre
              dir="auto"
              className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs"
            >
              {damagedDraft}
            </pre>
            <label className="flex min-h-11 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-5 shrink-0"
                checked={discardAccepted}
                onChange={(e) => setDiscardAccepted(e.target.checked)}
              />
              {c.discardDraftHelp}
            </label>
            <Button
              type="button"
              variant="outline"
              className="min-h-11 h-auto whitespace-normal"
              disabled={!discardAccepted || busy}
              onClick={() => {
                if (!receiptId) return;
                try {
                  discardOperationDraft(project.id, receiptId, damagedDraft);
                  setDamagedDraft(null);
                  setLocalError(null);
                  setDiscardAccepted(false);
                } catch {
                  setLocalError("storage");
                }
              }}
            >
              {c.discardDraft}
            </Button>
          </section>
        )}
        <p className="border bg-background/45 p-3 text-xs leading-5 text-muted-foreground">
          {c.proofHelp}
        </p>
        <ValidatedForm
          form={form}
          onSubmit={submit}
          className="space-y-4"
          onInvalid={(errors) => {
            if (errors.decision)
              document.getElementById("reconciliation-applied")?.focus();
            else form.setFocus("note");
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{c.decision}</legend>
            <RadioGroup
              value={decision.field.value}
              onValueChange={(value) => {
                decision.field.onChange(value);
                saveDraft({
                  ...form.getValues(),
                  decision: value as ReconciliationFormValues["decision"],
                });
              }}
              onBlur={decision.field.onBlur}
              disabled={busy || blocked || submitted !== null}
              className="grid gap-2 sm:grid-cols-2"
              aria-invalid={Boolean(fields.decision)}
              aria-label={c.decision}
              aria-describedby={`reconciliation-decision-description${fields.decision ? " reconciliation-decision-error" : ""}`}
            >
              {(
                [
                  [
                    "confirmed_applied",
                    c.applied,
                    c.appliedHelp,
                    "reconciliation-applied",
                  ],
                  [
                    "confirmed_not_applied",
                    c.notApplied,
                    c.notAppliedHelp,
                    "reconciliation-not-applied",
                  ],
                ] as const
              ).map(([value, label, help, id]) => (
                <Label
                  key={value}
                  htmlFor={id}
                  className="flex min-h-11 cursor-pointer items-start gap-3 border bg-background/55 p-3 text-start hover:border-primary/40"
                >
                  <RadioGroupItem
                    id={id}
                    value={value}
                    ref={
                      value === "confirmed_applied"
                        ? decision.field.ref
                        : undefined
                    }
                    aria-label={label}
                    className="mt-0.5 shrink-0"
                  />
                  <span>
                    <strong className="block text-sm">{label}</strong>
                    <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                      {help}
                    </span>
                  </span>
                </Label>
              ))}
            </RadioGroup>
            <p
              id="reconciliation-decision-description"
              className="text-xs leading-5 text-muted-foreground"
            >
              {c.decisionHelp}
            </p>
            {fields.decision && (
              <p
                id="reconciliation-decision-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {fields.decision.message}
              </p>
            )}
          </fieldset>
          <div className="space-y-2">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <Label htmlFor="reconciliation-note">{c.note}</Label>
              <span className="text-xs text-muted-foreground">
                {t("noteBytes", {
                  used: number.format(
                    operationNoteBytes(note.field.value.trim()),
                  ),
                  limit: number.format(2000),
                })}
              </span>
            </div>
            <Textarea
              {...note.field}
              onChange={(event) => {
                note.field.onChange(event);
                saveDraft({ ...form.getValues(), note: event.target.value });
              }}
              id="reconciliation-note"
              rows={5}
              maxLength={2000}
              disabled={busy}
              readOnly={blocked || submitted !== null}
              dir="auto"
              aria-invalid={Boolean(fields.note)}
              aria-describedby={`reconciliation-note-description${fields.note ? " reconciliation-note-error" : ""}`}
              className="min-h-28 resize-y bg-background/60 text-sm leading-6"
              placeholder={c.notePlaceholder}
            />
            <p
              id="reconciliation-note-description"
              className="text-xs leading-5 text-muted-foreground"
            >
              {t("noteHelp", { count: number.format(2000) })}
            </p>
            {fields.note && (
              <p
                id="reconciliation-note-error"
                role="alert"
                className="text-sm text-destructive"
              >
                {fields.note.message}
              </p>
            )}
          </div>
          {submitted && (
            <p className="text-xs leading-5 text-muted-foreground">
              {c.sameIntent}
            </p>
          )}
          {status && (
            <div
              className="border border-attention/30 bg-attention/[0.07] p-3 text-sm leading-6 text-attention-foreground"
              role="status"
            >
              <CircleAlert size={15} className="inline me-2" aria-hidden />
              {status}
            </div>
          )}
          {localError && (
            <p role="alert" className="text-sm leading-6 text-destructive">
              {localError === "storage"
                ? submitted
                  ? c.recoveryStorage
                  : c.draftStorage
                : c.recoveryBlocked}
            </p>
          )}
          {review.kind === "recorded" && (
            <section
              className="space-y-2 border bg-background p-3 text-sm"
              aria-label={c.recordedAudit}
            >
              <h3 className="font-medium">{c.recordedAudit}</h3>
              <p className="whitespace-pre-wrap" dir="auto">
                {review.audit.note}
              </p>
              <p>
                <bdi>{review.audit.actorId}</bdi>
              </p>
              <p className="text-xs text-muted-foreground">
                {time(review.audit.reconciledAt)}
              </p>
              {submitted && (
                <Button
                  type="button"
                  className="min-h-11 h-auto whitespace-normal"
                  onClick={acknowledge}
                >
                  {c.acknowledgeRecord}
                </Button>
              )}
            </section>
          )}
          {review.kind !== "recorded" &&
            (blocked || review.kind !== "initial") && (
              <Button
                type="button"
                variant="outline"
                className="min-h-11 h-auto whitespace-normal py-2"
                disabled={busy}
                aria-busy={checking}
                onClick={() => void checkRecord()}
              >
                {c.checkRecord}
              </Button>
            )}
          <AlertDialogFooter>
            <AlertDialogCancel
              ref={cancelRef}
              type="button"
              disabled={busy}
              className="min-h-11 h-auto whitespace-normal py-2"
              onClick={() => requestOpenChange(false)}
            >
              {c.cancel}
            </AlertDialogCancel>
            <Button
              ref={saveRef}
              type="submit"
              disabled={busy || blocked}
              aria-busy={pending}
              className="min-h-11 h-auto whitespace-normal py-2"
            >
              {pending && (
                <Loader2
                  size={14}
                  className="shrink-0 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              )}
              {c.save}
            </Button>
          </AlertDialogFooter>
        </ValidatedForm>
      </AlertDialogContent>
    </AlertDialog>
  );
}
