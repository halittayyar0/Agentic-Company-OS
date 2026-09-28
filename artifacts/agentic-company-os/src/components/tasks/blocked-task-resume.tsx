import { useEffect, useId, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4-mini";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getTaskQuestion,
  getTaskAnswerReceipt,
  resumeTask,
  getGetTaskQueryKey,
  getListTasksQueryKey,
  getListTaskActivityQueryKey,
  getGetOrgSummaryQueryKey,
  type Agent,
  type Task,
  type TaskAnswerReceipt,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useLocale } from "@/components/i18n/locale-provider";
import { useToast } from "@/hooks/use-toast";
import { studioText, type ProjectStudioCopy } from "@/lib/project-studio-copy";

type Draft = {
  questionId: string;
  question: string;
  ownerAgentId: number;
  answer: string;
  requestId?: string;
};
const validId = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
function parseDraft(value: unknown): Draft | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<Draft>;
  return validId(v.questionId) &&
    typeof v.question === "string" &&
    v.question.trim().length > 0 &&
    v.question.length <= 1000 &&
    typeof v.ownerAgentId === "number" &&
    Number.isSafeInteger(v.ownerAgentId) &&
    v.ownerAgentId > 0 &&
    typeof v.answer === "string" &&
    v.answer.length <= 1200 &&
    (v.requestId === undefined || validId(v.requestId))
    ? {
        questionId: v.questionId,
        question: v.question,
        ownerAgentId: v.ownerAgentId,
        answer: v.answer,
        requestId: v.requestId,
      }
    : null;
}
const storageKey = (taskId: number) => `acos.task-answer.v1:${taskId}`;
function readDraft(taskId: number): { draft: Draft | null; error: boolean } {
  try {
    const raw = sessionStorage.getItem(storageKey(taskId));
    if (!raw) return { draft: null, error: false };
    const draft = parseDraft(JSON.parse(raw));
    return { draft, error: !draft };
  } catch {
    return { draft: null, error: true };
  }
}

export function BlockedTaskResume({
  task,
  owner,
  onResumed,
  disabled = false,
  c,
}: {
  task: Task;
  owner?: Agent;
  onResumed?: () => void;
  disabled?: boolean;
  c: ProjectStudioCopy;
}) {
  const { locale } = useLocale();
  const id = useId();
  const client = useQueryClient();
  const { toast } = useToast();
  const [initial] = useState(() => readDraft(task.id));
  const [draft, setDraft] = useState<Draft | null>(initial.draft);
  const [storageError, setStorageError] = useState(initial.error);
  const [phase, setPhase] = useState<"send" | "check" | null>(null);
  const busy = phase !== null;
  const [notRecorded, setNotRecorded] = useState(false);
  const [receipt, setReceipt] = useState<TaskAnswerReceipt | null>(null);
  const guard = useRef(false);
  const alive = useRef(true);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const waiting =
    task.status === "blocked" && task.blockedReason === "user_input";
  const question = useQuery({
    queryKey: ["task-question", task.id],
    queryFn: ({ signal }) =>
      getTaskQuestion(task.id, { signal, cache: "no-store" }),
    enabled: waiting || Boolean(draft),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const form = useForm({
    defaultValues: { answer: initial.draft?.answer ?? "" },
    mode: "onTouched",
    resolver: zodResolver(
      z.object({
        answer: z.string().check(
          z.refine((v) => Boolean(v.trim()), c.answerRequired),
          z.maxLength(1200, c.answerLong),
        ),
      }),
    ),
  });
  useEffect(() => {
    if (
      waiting &&
      question.data?.answerable &&
      question.data.questionId !== receipt?.questionId &&
      receipt?.outcome === "accepted"
    )
      setReceipt(null);
  }, [waiting, question.data, receipt]);
  const field = form.register("answer");
  const answer = form.watch("answer");
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const save = (next: Draft) => {
    try {
      sessionStorage.setItem(storageKey(task.id), JSON.stringify(next));
      setStorageError(false);
      return true;
    } catch {
      setStorageError(true);
      return false;
    }
  };
  useEffect(() => {
    const q = question.data;
    if (
      !draft &&
      q?.questionId &&
      q.question &&
      q.ownerAgentId &&
      waiting &&
      !receipt
    ) {
      const next = {
        questionId: q.questionId,
        question: q.question,
        ownerAgentId: q.ownerAgentId,
        answer: form.getValues("answer"),
      };
      setDraft(next);
    }
  }, [question.data, draft, waiting, receipt, form]);
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: getGetTaskQueryKey(task.id) }),
      client.invalidateQueries({ queryKey: getListTasksQueryKey() }),
      client.invalidateQueries({
        queryKey: getListTaskActivityQueryKey(task.id),
      }),
      client.invalidateQueries({ queryKey: getGetOrgSummaryQueryKey() }),
      client.invalidateQueries({ queryKey: ["task-question", task.id] }),
    ]);
  const settle = (result: TaskAnswerReceipt, sent: Draft) => {
    if (
      result.taskId !== task.id ||
      result.requestId !== sent.requestId ||
      result.questionId !== sent.questionId ||
      !["accepted", "rejected"].includes(result.outcome)
    )
      throw Error("Receipt mismatch");
    if (!alive.current) return;
    setReceipt(result);
    setNotRecorded(false);
    if (result.outcome === "accepted") {
      try {
        const current = readDraft(task.id).draft;
        if (current?.requestId === sent.requestId)
          sessionStorage.removeItem(storageKey(task.id));
      } catch {
        /* A retained marker remains safe: GET can recover this same receipt. */
      }
      setDraft(null);
      form.reset({ answer: "" });
      onResumed?.();
      toast({ title: c.answerAccepted });
    } else {
      const next = { ...sent, requestId: undefined };
      setDraft(next);
      save(next);
    }
    void invalidate();
  };
  const dispatch = async (sent: Draft) => {
    if (disabled || guard.current || !sent.requestId || !save(sent)) return;
    guard.current = true;
    setPhase("send");
    setReceipt(null);
    setNotRecorded(false);
    setDraft(sent);
    try {
      const result = await resumeTask(
        task.id,
        {
          requestId: sent.requestId,
          questionId: sent.questionId,
          answer: sent.answer.trim(),
        },
        { signal: AbortSignal.timeout(30000) },
      );
      settle(result, sent);
    } catch {
      if (alive.current)
        window.requestAnimationFrame(() => textarea.current?.focus());
    } finally {
      guard.current = false;
      if (alive.current) setPhase(null);
    }
  };
  const check = async () => {
    if (!draft?.requestId || guard.current) return;
    guard.current = true;
    setPhase("check");
    setNotRecorded(false);
    try {
      settle(
        await getTaskAnswerReceipt(task.id, draft.requestId, {
          signal: AbortSignal.timeout(20000),
          cache: "no-store",
        }),
        draft,
      );
    } catch (error) {
      if (alive.current)
        setNotRecorded(
          Boolean(
            error &&
            typeof error === "object" &&
            "status" in error &&
            error.status === 404,
          ),
        );
    } finally {
      guard.current = false;
      if (alive.current) setPhase(null);
    }
  };
  if (!waiting && !draft && !receipt) return null;
  if (receipt?.outcome === "accepted")
    return (
      <p
        role="status"
        className="mx-auto mt-4 max-w-[1680px] rounded-2xl border border-border bg-card p-4 text-sm"
      >
        {c.answerAccepted}
      </p>
    );
  const q = question.data;
  const changed = Boolean(
    draft && q?.questionId && draft.questionId !== q.questionId,
  );
  const pending = Boolean(draft?.requestId);
  const ready =
    !disabled &&
    !question.isError &&
    !question.isFetching &&
    q?.answerable &&
    !changed &&
    draft?.questionId === q.questionId &&
    !pending &&
    !busy;
  const error = form.formState.errors.answer?.message;
  const rejection =
    receipt?.outcome === "rejected"
      ? {
          task_changed: c.answerTaskChanged,
          question_changed: c.answerChanged,
          owner_inactive: c.answerOwnerInactive,
          emergency_stop: c.answerEmergency,
        }[receipt.reason ?? "task_changed"]
      : null;
  const name =
    owner && owner.id === (draft?.ownerAgentId ?? q?.ownerAgentId)
      ? owner.name
      : c.coordinator;
  return (
    <section
      aria-labelledby={`${id}-title`}
      className="mx-auto mt-4 max-w-[1680px] overflow-hidden rounded-2xl border border-amber-500/25 bg-card"
    >
      <div className="grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
        <div className="border-b border-border bg-muted/30 p-5 md:border-b-0 md:border-e">
          <h2 id={`${id}-title`} className="text-base font-semibold">
            {waiting
              ? studioText(c.answerHeading, { name })
              : c.answerQuestionLabel}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {c.answerHelp}
          </p>
          <h3 className="mt-5 text-xs font-semibold text-muted-foreground">
            {c.answerQuestionLabel}
          </h3>
          {draft ? (
            <p
              dir="auto"
              className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed"
            >
              {draft.question}
            </p>
          ) : (
            <p role="status" className="mt-2 text-sm">
              {question.isPending ? c.loading : c.answerUnavailable}
            </p>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{c.source}</p>
          {(question.isError ||
            (!q?.answerable && !question.isPending) ||
            changed) &&
            !pending && (
              <div className="mt-4 space-y-3 text-sm">
                <p role="alert">
                  {question.isError
                    ? c.answerQuestionError
                    : changed
                      ? c.answerChanged
                      : c.answerUnavailable}
                </p>
                {changed && q?.questionId && q.question && q.ownerAgentId ? (
                  <Button
                    className="h-auto min-h-11 whitespace-normal"
                    variant="outline"
                    onClick={() => {
                      const next = {
                        questionId: q.questionId!,
                        question: q.question!,
                        ownerAgentId: q.ownerAgentId!,
                        answer: form.getValues("answer"),
                      };
                      if (save(next)) {
                        setDraft(next);
                        setReceipt(null);
                        form.clearErrors();
                        textarea.current?.focus();
                      }
                    }}
                  >
                    {c.answerReview}
                  </Button>
                ) : (
                  <Button
                    className="min-h-11"
                    variant="outline"
                    disabled={question.isFetching}
                    onClick={() => void question.refetch()}
                  >
                    {c.retry}
                  </Button>
                )}
              </div>
            )}
        </div>
        <form
          className="min-w-0 p-5"
          aria-busy={busy}
          onSubmit={form.handleSubmit(({ answer }) => {
            if (ready && draft)
              void dispatch({
                ...draft,
                answer,
                requestId: crypto.randomUUID(),
              });
          })}
        >
          <label htmlFor={`${id}-answer`} className="text-sm font-semibold">
            {c.answerLabel}
          </label>
          <Textarea
            {...field}
            ref={(node) => {
              field.ref(node);
              textarea.current = node;
            }}
            id={`${id}-answer`}
            rows={4}
            maxLength={1200}
            dir="auto"
            readOnly={!draft || pending || busy}
            value={answer}
            onChange={(event) => {
              void field.onChange(event);
              if (draft) {
                const next = { ...draft, answer: event.target.value };
                setDraft(next);
                save(next);
              }
            }}
            aria-invalid={Boolean(error)}
            aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
            aria-errormessage={error ? `${id}-error` : undefined}
            placeholder={c.answerPlaceholder}
            className="mt-2 min-h-32 resize-y text-base leading-relaxed"
          />
          <div
            id={`${id}-help`}
            className="mt-2 flex flex-wrap items-start justify-between gap-2 text-xs leading-relaxed text-muted-foreground"
          >
            <span className="max-w-prose">
              {pending ? c.answerPendingHelp : c.answerDraft}
            </span>
            <span className="tabular-nums">
              {answer.length.toLocaleString(locale)}/
              {(1200).toLocaleString(locale)}
            </span>
          </div>
          {error && (
            <p
              id={`${id}-error`}
              role="alert"
              className="mt-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          {storageError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {c.answerStorage}
            </p>
          )}
          {rejection && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {c.answerRejected} {rejection}
            </p>
          )}
          {pending && !busy && (
            <p role="alert" className="mt-3 text-sm leading-relaxed">
              {notRecorded ? c.answerNotRecorded : c.answerUnknown}
            </p>
          )}
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {pending ? (
              <>
                <Button
                  type="button"
                  className="h-auto min-h-11 whitespace-normal"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void check()}
                >
                  {busy
                    ? phase === "send"
                      ? c.answerSending
                      : c.checking
                    : c.answerCheck}
                </Button>
                {notRecorded && (
                  <Button
                    type="button"
                    className="h-auto min-h-11 whitespace-normal"
                    disabled={busy || disabled}
                    onClick={() => draft && void dispatch(draft)}
                  >
                    {c.answerRetry}
                  </Button>
                )}
              </>
            ) : (
              <Button
                type="submit"
                className="h-auto min-h-11 whitespace-normal"
                disabled={!ready || !answer.trim()}
              >
                {busy ? c.answerSending : c.answerSend}
              </Button>
            )}
          </div>
        </form>
      </div>
    </section>
  );
}
