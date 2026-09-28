import { LanguagePackStatus } from "../i18n/language-pack-status";
import {
  MeetingCommandRecovery,
  useMeetingCommandPending,
} from "./meeting-command-recovery";
import {
  readMeetingCommand,
  acknowledgeMeetingCommand,
  type MeetingCommandIntent,
  MeetingCommandRecoveryError,
} from "@/lib/meeting-command-recovery";
import type { ProjectMeetingCommandResult } from "@workspace/api-client-react";
import {
  createContext,
  useContext,
  useCallback,
  useSyncExternalStore,
  useId,
} from "react";
import { useForm, useController } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v4-mini";
import { ValidatedForm } from "@/components/ui/validated-form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from "@/components/ui/alert-dialog";
import {
  loadMeetingCopy,
  meetingText,
  type MeetingCopy,
} from "@/lib/meeting-copy";
import {
  getMeetingDrafts,
  updateMeetingDrafts,
  subscribeMeetingDrafts,
  emptyMeetingSession,
  emptyMeetingDraft,
  type MeetingDraft,
  type MeetingDraftSession,
} from "@/lib/meeting-drafts";
import type { Locale } from "@/lib/i18n";
import { useLocale } from "@/components/i18n/locale-provider";
import { loadMeetingTurnCopy } from "@/lib/meeting-turn-copy";
import {
  prepareMeetingTurn,
  dispatchMeetingTurn,
  type MeetingTurnInput,
  acknowledgeMeetingTurn,
  MeetingTurnRecoveryError,
} from "@/lib/meeting-turn-recovery";
import {
  MeetingTurnRecovery,
  useMeetingTurnPending,
} from "./meeting-turn-recovery";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@workspace/api-client-react";
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardList,
  ListTodo,
  MessageSquareText,
  Play,
  Plus,
  RefreshCw,
  Scale,
  X,
} from "lucide-react";

import { AgentAvatar } from "@/components/agent/agent-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  addProjectMeetingAction,
  addProjectMeetingDecision,
  completeProjectMeeting,
  createProjectMeeting,
  getProjectMeeting,
  listProjectMeetings,
  projectMeetingDetailQueryKey,
  projectMeetingsQueryKey,
  updateProjectMeetingAction,
  type AddProjectMeetingActionInput,
  type AddProjectMeetingDecisionInput,
  type CreateProjectMeetingInput,
  type ProjectMeeting,
  type ProjectMeetingDetail,
  type ProjectMeetingStatus,
} from "@/lib/project-meetings";
import { cn } from "@/lib/utils";

const MeetingCopyContext = createContext<{
  c: MeetingCopy;
  locale: Locale;
} | null>(null);
function useMeetingCopy() {
  const value = useContext(MeetingCopyContext);
  if (!value) throw Error("Meeting copy is unavailable");
  return value;
}
const MEETING_STATUS: Record<ProjectMeetingStatus, { className: string }> = {
  draft: { className: "text-muted-foreground" },
  scheduled: { className: "text-primary" },
  in_progress: { className: "text-primary" },
  completed: { className: "text-primary" },
  cancelled: { className: "text-muted-foreground" },
};
export function ProjectMeetings(props: {
  projectId: number;
  members: Agent[];
}) {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["meeting-copy", locale],
    queryFn: async () => {
      // Recovery must be readable before any meeting write becomes available.
      const [copy] = await Promise.all([
        loadMeetingCopy(locale),
        loadMeetingTurnCopy(locale),
      ]);
      return copy;
    },
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        as="div"
        className="space-y-3 rounded-xl border p-5"
        buttonClassName="min-h-11"
      />
    );
  return (
    <MeetingCopyContext.Provider value={{ c: copy.data, locale }}>
      <MeetingWorkspace key={props.projectId} {...props} />
    </MeetingCopyContext.Provider>
  );
}
function MeetingWorkspace({
  projectId,
  members,
}: {
  projectId: number;
  members: Agent[];
}) {
  const { c, locale } = useMeetingCopy();
  const snapshot = useSyncExternalStore(
    useCallback(
      (listener) => subscribeMeetingDrafts(projectId, listener),
      [projectId],
    ),
    useCallback(() => getMeetingDrafts(projectId), [projectId]),
  );
  const setSession = (
    update: (session: MeetingDraftSession) => MeetingDraftSession,
  ) => updateMeetingDrafts(projectId, update);
  const { selectedMeetingId, createOpen, title, agenda, drafts } =
    snapshot.session;
  const participantIds = snapshot.session.participantIds ?? [];
  const setSelectedMeetingId = (value: number | null) =>
    setSession((s) =>
      s.selectedMeetingId === value ? s : { ...s, selectedMeetingId: value },
    );
  const setCreateOpen = (value: boolean) =>
    setSession((s) => ({ ...s, createOpen: value }));
  const setTitle = (value: string) =>
    setSession((s) => ({ ...s, title: value }));
  const setAgenda = (value: string) =>
    setSession((s) => ({ ...s, agenda: value }));
  const setParticipantIds = (
    value: number[] | ((previous: number[]) => number[]),
  ) =>
    setSession((s) => ({
      ...s,
      participantIds:
        typeof value === "function" ? value(s.participantIds ?? []) : value,
    }));
  const setDrafts = (
    value:
      | Record<number, MeetingDraft>
      | ((
          previous: Record<number, MeetingDraft>,
        ) => Record<number, MeetingDraft>),
  ) =>
    setSession((s) => ({
      ...s,
      drafts: typeof value === "function" ? value(s.drafts) : value,
    }));
  const {
    transcriptDraft,
    decisionDraft,
    decisionOwnerId,
    actionDraft,
    actionOwnerId,
    completionSummary,
  } =
    selectedMeetingId === null
      ? emptyMeetingDraft
      : (drafts[selectedMeetingId] ?? emptyMeetingDraft);
  function setDraft<K extends keyof MeetingDraft>(
    id: number | null,
    key: K,
    value: MeetingDraft[K] | ((previous: MeetingDraft[K]) => MeetingDraft[K]),
  ) {
    if (id === null) return;
    setDrafts((previous) => {
      const current = previous[id] ?? emptyMeetingDraft;
      return {
        ...previous,
        [id]: {
          ...current,
          [key]:
            typeof value === "function"
              ? (value as (v: MeetingDraft[K]) => MeetingDraft[K])(current[key])
              : value,
        },
      };
    });
  }
  const setTranscriptDraft = (v: string) =>
    setDraft(selectedMeetingId, "transcriptDraft", v);
  const setDecisionDraft = (v: string) =>
    setDraft(selectedMeetingId, "decisionDraft", v);
  const setDecisionOwnerId = (v: number | null) =>
    setDraft(selectedMeetingId, "decisionOwnerId", v);
  const setActionDraft = (v: string) =>
    setDraft(selectedMeetingId, "actionDraft", v);
  const setActionOwnerId = (v: number | null) =>
    setDraft(selectedMeetingId, "actionOwnerId", v);
  const setCompletionSummary = (v: string) =>
    setDraft(selectedMeetingId, "completionSummary", v);
  const [reviewDrafts, setReviewDrafts] = useState(false);
  const draftReviewTrigger = useRef<HTMLButtonElement>(null);
  const meetingHeading = useRef<HTMLHeadingElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pendingTurn = useMeetingTurnPending(projectId, selectedMeetingId);
  const pendingCommand = useMeetingCommandPending(projectId);

  const turnCopy = useQuery({
    queryKey: ["meeting-turn-copy", locale],
    queryFn: () => loadMeetingTurnCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  const turnError = (error: unknown) =>
    error instanceof MeetingTurnRecoveryError && error.code === "storage"
      ? turnCopy.data?.storage
      : turnCopy.data?.requestFailed;
  async function dispatchSavedTurn(meetingId: number, input: MeetingTurnInput) {
    const intent = prepareMeetingTurn(projectId, meetingId, input);
    const detail = await dispatchMeetingTurn(intent);
    return { intent, detail };
  }
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const activeMembers = useMemo(
    () => members.filter((member) => member.isActive),
    [members],
  );
  const defaultParticipantIds = useMemo(
    () => activeMembers.map((member) => member.id),
    [activeMembers],
  );

  const meetingsQuery = useQuery({
    queryKey: projectMeetingsQueryKey(projectId),
    queryFn: () => listProjectMeetings(projectId),
    refetchInterval: 10_000,
  });
  const meetings = meetingsQuery.data ?? [];

  useEffect(() => {
    if (!meetingsQuery.data) return;
    if (meetings.length === 0) {
      setSelectedMeetingId(null);
      return;
    }
    if (!meetings.some(({ meeting }) => meeting.id === selectedMeetingId)) {
      setSelectedMeetingId(meetings[0].meeting.id);
    }
  }, [meetings, selectedMeetingId]);

  const detailQuery = useQuery({
    queryKey: projectMeetingDetailQueryKey(projectId, selectedMeetingId ?? 0),
    queryFn: () => getProjectMeeting(projectId, selectedMeetingId!),
    enabled: selectedMeetingId !== null,
    refetchInterval: 8_000,
  });

  const refreshMeeting = async (meetingId: number) => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: projectMeetingsQueryKey(projectId),
      }),
      queryClient.invalidateQueries({
        queryKey: projectMeetingDetailQueryKey(projectId, meetingId),
      }),
    ]);
  };

  function acknowledgeCommand(result: ProjectMeetingCommandResult) {
    if (!mounted.current) return;
    const intent = readMeetingCommand(projectId);
    if (intent?.requestId !== result.requestId) return false;
    if (!acknowledgeMeetingCommand(intent)) return false;
    return true;
  }
  async function reviewCommand(
    intent: MeetingCommandIntent,
    result: ProjectMeetingCommandResult,
  ) {
    if (!acknowledgeMeetingCommand(intent))
      throw new MeetingCommandRecoveryError("pending");
    if (result.ok) {
      if (intent.kind === "create") {
        setSession((s) =>
          s.title.trim() === intent.input.title &&
          s.agenda.trim() === (intent.input.agenda ?? "") &&
          JSON.stringify(s.participantIds ?? []) ===
            JSON.stringify(intent.input.participantAgentIds ?? [])
            ? { ...s, title: "", agenda: "", createOpen: false }
            : s,
        );
      } else if (intent.kind === "decision") {
        setDrafts((previous) => {
          const draft = previous[intent.meetingId!];
          return draft &&
            draft.decisionDraft.trim() === intent.input.content &&
            draft.decisionOwnerId === (intent.input.ownerAgentId ?? null)
            ? {
                ...previous,
                [intent.meetingId!]: { ...draft, decisionDraft: "" },
              }
            : previous;
        });
      } else if (intent.kind === "action") {
        setDrafts((previous) => {
          const draft = previous[intent.meetingId!];
          return draft &&
            draft.actionDraft.trim() === intent.input.title &&
            draft.actionOwnerId === (intent.input.ownerAgentId ?? null)
            ? {
                ...previous,
                [intent.meetingId!]: { ...draft, actionDraft: "" },
              }
            : previous;
        });
      } else if (intent.kind === "complete")
        setDraft(intent.meetingId, "completionSummary", (value) =>
          value.trim() === intent.input.summary ? "" : value,
        );
    }
    if (result.meetingId !== null) {
      await refreshMeeting(result.meetingId);
      if (result.ok) setSelectedMeetingId(result.meetingId);
    } else
      await queryClient.invalidateQueries({
        queryKey: projectMeetingsQueryKey(projectId),
      });
  }
  const createMeeting = useMutation({
    mutationFn: () =>
      createProjectMeeting(projectId, {
        title: title.trim(),
        agenda: agenda.trim() || null,
        participantAgentIds: participantIds,
      } satisfies CreateProjectMeetingInput),
    onSuccess: async (result) => {
      if (!mounted.current) return;
      const intent = readMeetingCommand(projectId);
      if (intent?.requestId === result.requestId)
        await reviewCommand(intent, result);
      toast({ title: c.created });
    },
    onError: () => toast({ title: c.saveError, variant: "destructive" }),
  });

  const meetingTurn = useMutation({
    mutationFn: (input: {
      meetingId: number;
      prompt: string;
      participantAgentIds: number[];
    }) =>
      dispatchSavedTurn(input.meetingId, {
        prompt: input.prompt,
        participantAgentIds: input.participantAgentIds,
      }),
    onSuccess: async ({ detail, intent }, input) => {
      if (!mounted.current) return;
      if (!acknowledgeMeetingTurn(intent)) return;
      setDraft(input.meetingId, "transcriptDraft", (value) =>
        value.trim() === input.prompt ? "" : value,
      );
      await refreshMeeting(input.meetingId);
      toast({
        title: c.turnComplete,
        description: detail.agentTranscriptIds.length
          ? meetingText(c.contributions, {
              count: meetingNumber(detail.agentTranscriptIds.length, locale),
            })
          : c.noContribution,
      });
    },
    onError: (_error) =>
      toast({
        title: c.saveError,
        description: turnError(_error),
        variant: "destructive",
      }),
  });

  const decisionMutation = useMutation({
    mutationFn: (input: {
      meetingId: number;
      content: string;
      ownerAgentId: number | null;
    }) =>
      addProjectMeetingDecision(projectId, input.meetingId, {
        content: input.content,
        ownerAgentId: input.ownerAgentId,
      } satisfies AddProjectMeetingDecisionInput),
    onSuccess: async (result, input) => {
      if (!mounted.current) return;
      if (!acknowledgeCommand(result)) return;
      setDrafts((previous) => {
        const draft = previous[input.meetingId];
        if (
          !draft ||
          draft.decisionDraft.trim() !== input.content ||
          draft.decisionOwnerId !== input.ownerAgentId
        )
          return previous;
        return {
          ...previous,
          [input.meetingId]: { ...draft, decisionDraft: "" },
        };
      });
      await refreshMeeting(input.meetingId);
    },
    onError: (_error) =>
      toast({
        title: c.saveError,
        variant: "destructive",
      }),
  });

  const actionMutation = useMutation({
    mutationFn: (input: {
      meetingId: number;
      title: string;
      ownerAgentId: number | null;
    }) =>
      addProjectMeetingAction(projectId, input.meetingId, {
        title: input.title,
        ownerAgentId: input.ownerAgentId,
      } satisfies AddProjectMeetingActionInput),
    onSuccess: async (result, input) => {
      if (!mounted.current) return;
      if (!acknowledgeCommand(result)) return;
      setDrafts((previous) => {
        const draft = previous[input.meetingId];
        if (
          !draft ||
          draft.actionDraft.trim() !== input.title ||
          draft.actionOwnerId !== input.ownerAgentId
        )
          return previous;
        return {
          ...previous,
          [input.meetingId]: { ...draft, actionDraft: "" },
        };
      });
      await refreshMeeting(input.meetingId);
    },
    onError: (_error) =>
      toast({
        title: c.saveError,
        variant: "destructive",
      }),
  });

  const actionStatusMutation = useMutation({
    mutationFn: ({
      actionItemId,
      status,
      meetingId,
    }: {
      actionItemId: number;
      meetingId: number;
      status: "open" | "done";
    }) =>
      updateProjectMeetingAction(projectId, meetingId, actionItemId, {
        status,
      }),
    onSuccess: async (result, input) => {
      if (!mounted.current) return;
      if (!acknowledgeCommand(result)) return;
      await refreshMeeting(input.meetingId);
    },
    onError: (_error) =>
      toast({
        title: c.saveError,
        variant: "destructive",
      }),
  });

  const startMeeting = useMutation({
    mutationFn: (detail: ProjectMeetingDetail) =>
      dispatchSavedTurn(detail.meeting.id, {
        prompt: detail.meeting.agenda ?? detail.meeting.title,
        participantAgentIds: detail.participants.map(
          (participant) => participant.agentId,
        ),
      }),
    onSuccess: async ({ detail, intent }) => {
      if (!mounted.current) return;
      if (!acknowledgeMeetingTurn(intent)) return;
      await refreshMeeting(detail.meeting.id);
      toast({
        title: c.started,
        description: detail.agentTranscriptIds.length
          ? meetingText(c.contributions, {
              count: meetingNumber(detail.agentTranscriptIds.length, locale),
            })
          : c.noContribution,
      });
    },
    onError: (_error) =>
      toast({
        title: c.saveError,
        description: turnError(_error),
        variant: "destructive",
      }),
  });

  const completeMeeting = useMutation({
    mutationFn: ({
      meetingId,
      summary,
    }: {
      meetingId: number;
      summary: string;
    }) => completeProjectMeeting(projectId, meetingId, { summary }),
    onSuccess: async (result, input) => {
      if (!mounted.current) return;
      if (!acknowledgeCommand(result)) return;
      setDraft(input.meetingId, "completionSummary", (value) =>
        value.trim() === input.summary ? "" : value,
      );
      await refreshMeeting(input.meetingId);
      toast({ title: c.completedTitle });
    },
    onError: (_error) =>
      toast({
        title: c.saveError,
        variant: "destructive",
      }),
  });

  const toggleParticipant = (agentId: number) => {
    setParticipantIds((current) =>
      current.includes(agentId)
        ? current.filter((id) => id !== agentId)
        : [...current, agentId],
    );
  };

  const openCreateForm = () => {
    if (snapshot.session.participantIds === null)
      setParticipantIds(defaultParticipantIds);
    setCreateOpen(true);
  };

  const createSchema = useMemo(
    () =>
      z.object({
        title: z
          .string()
          .check(
            z.trim(),
            z.minLength(1, c.required),
            z.maxLength(
              200,
              meetingText(c.tooLong, { count: meetingNumber(200, locale) }),
            ),
          ),
        agenda: z
          .string()
          .check(
            z.maxLength(
              12000,
              meetingText(c.tooLong, { count: meetingNumber(12000, locale) }),
            ),
          ),
        participantIds: z
          .array(z.number())
          .check(
            z.refine(
              (ids) =>
                ids.every((id) => activeMembers.some((m) => m.id === id)),
              c.rosterChanged,
            ),
          ),
      }),
    [c, locale, activeMembers],
  );
  const createForm = useForm<{
    title: string;
    agenda: string;
    participantIds: number[];
  }>({
    resolver: zodResolver(createSchema),
    values: { title, agenda, participantIds },
    resetOptions: { keepErrors: true, keepTouched: true },
    mode: "onTouched",
  });
  const writeBlocked =
    snapshot.storageError ||
    meetingsQuery.isError ||
    detailQuery.isError ||
    Boolean(pendingCommand.intent || pendingCommand.error);
  const submitCreate = async () => {
    if (createMeeting.isPending || writeBlocked) return;
    try {
      await createMeeting.mutateAsync();
    } catch {
      /* localized mutation feedback retains the form */
    }
  };
  return (
    <section
      aria-labelledby="project-meetings-title"
      className="min-h-full [overflow-wrap:anywhere] [&_button]:min-h-11 [&_button]:whitespace-normal"
    >
      <header className="flex flex-wrap items-start justify-between gap-3 rounded-[22px] border border-border/70 bg-card px-[16px] py-4 sm:px-5">
        <div>
          <h2
            ref={meetingHeading}
            tabIndex={-1}
            id="project-meetings-title"
            className="flex items-center gap-2 text-sm font-bold"
          >
            <CalendarDays size={15} className="text-primary" aria-hidden />
            {c.title}
          </h2>
          <p className="mt-1 max-w-2xl text-[12px] leading-5 text-muted-foreground">
            {c.description}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={createOpen ? "outline" : "default"}
          className="gap-[8px] px-[12px] [&_svg]:size-[16px]"
          onClick={() => (createOpen ? setCreateOpen(false) : openCreateForm())}
        >
          {createOpen ? <X size={13} /> : <Plus size={13} />}
          {createOpen ? c.closeForm : c.newMeeting}
        </Button>
      </header>

      <MeetingCommandRecovery
        projectId={projectId}
        c={c}
        pending={pendingCommand}
        onReviewed={reviewCommand}
        focusTarget={meetingHeading}
      />
      <MeetingTurnRecovery
        projectId={projectId}
        meetingCopy={c}
        onRefresh={(meetingId) => void refreshMeeting(meetingId)}
        focusTarget={meetingHeading}
      />
      <p className="my-3 text-sm text-muted-foreground">{c.draftHelp}</p>
      {(snapshot.storageError || snapshot.damaged) && (
        <div
          role="alert"
          className="mb-3 space-y-3 rounded-xl border border-amber-600/40 p-4 text-sm"
        >
          <p>{snapshot.damaged ? c.damagedDraft : c.draftError}</p>
          <Button
            ref={draftReviewTrigger}
            variant="outline"
            onClick={() => setReviewDrafts(true)}
          >
            {c.resetDrafts}
          </Button>
        </div>
      )}
      <AlertDialog open={reviewDrafts} onOpenChange={setReviewDrafts}>
        <AlertDialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (draftReviewTrigger.current ?? meetingHeading.current)?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{c.resetDrafts}</AlertDialogTitle>
            <AlertDialogDescription>{c.resetHelp}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{c.keepDrafts}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                updateMeetingDrafts(
                  projectId,
                  () => emptyMeetingSession(projectId),
                  true,
                )
              }
            >
              {c.resetConfirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {createOpen ? (
        <ValidatedForm
          form={createForm}
          onSubmit={submitCreate}
          onInvalid={(errors) => {
            if (errors.participantIds && !errors.title && !errors.agenda)
              document.getElementById("meeting-participant-picker")?.focus();
          }}
          aria-busy={createMeeting.isPending}
          className="mt-3 rounded-[22px] border border-border/70 bg-card/70 p-4 sm:p-5"
        >
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
            <div className="space-y-3">
              <label
                className="block text-xs font-semibold"
                htmlFor="meeting-title"
              >
                {c.titleLabel}
              </label>
              <Input
                {...createForm.register("title")}
                aria-invalid={Boolean(createForm.formState.errors.title)}
                aria-describedby="meeting-title-error"
                id="meeting-title"
                value={title}
                onChange={(event) => {
                  void createForm.register("title").onChange(event);
                  setTitle(event.target.value);
                }}
                maxLength={200}
                placeholder={c.titlePlaceholder}
                disabled={createMeeting.isPending}
              />
              <p
                id="meeting-title-error"
                role={createForm.formState.errors.title ? "alert" : undefined}
                className="text-sm text-destructive"
              >
                {createForm.formState.errors.title?.message}
              </p>
              <label
                className="block text-xs font-semibold"
                htmlFor="meeting-agenda"
              >
                {c.agendaLabel}{" "}
                <span className="font-normal text-muted-foreground">
                  ({c.optional})
                </span>
              </label>
              <Textarea
                {...createForm.register("agenda")}
                aria-invalid={Boolean(createForm.formState.errors.agenda)}
                aria-describedby="meeting-agenda-error"
                id="meeting-agenda"
                value={agenda}
                onChange={(event) => {
                  void createForm.register("agenda").onChange(event);
                  setAgenda(event.target.value);
                }}
                maxLength={12000}
                rows={4}
                placeholder={c.agendaPlaceholder}
                disabled={createMeeting.isPending}
                className="resize-y"
              />
              <p
                id="meeting-agenda-error"
                role={createForm.formState.errors.agenda ? "alert" : undefined}
                className="text-sm text-destructive"
              >
                {createForm.formState.errors.agenda?.message}
              </p>
            </div>
            <ParticipantPicker
              error={createForm.formState.errors.participantIds?.message}
              agents={activeMembers}
              selectedIds={participantIds}
              onToggle={toggleParticipant}
              disabled={createMeeting.isPending}
            />
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-4">
            <p className="text-[12px] text-muted-foreground">
              {participantIds.length
                ? meetingText(c.selectedCount, {
                    count: meetingNumber(participantIds.length, locale),
                  })
                : c.noSelection}
            </p>
            <Button
              type="submit"
              disabled={createMeeting.isPending || writeBlocked}
              aria-busy={createMeeting.isPending}
            >
              {createMeeting.isPending ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Play size={13} />
              )}
              {createMeeting.isPending ? c.saving : c.saveDraft}
            </Button>
          </div>
          {createMeeting.isError && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {c.saveError}
            </p>
          )}
        </ValidatedForm>
      ) : null}

      <div className="mt-3 grid min-h-[510px] overflow-hidden rounded-[22px] border border-border/70 bg-card lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside
          aria-label={c.list}
          className="border-b border-border/60 bg-background/35 lg:border-b-0 lg:border-e"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-3">
            <span className="text-xs font-bold">{c.listTitle}</span>
            <span className="font-mono text-[12px] text-muted-foreground">
              {meetingNumber(meetings.length, locale)}
            </span>
          </div>
          {meetingsQuery.isError && meetingsQuery.data && (
            <div role="alert" className="space-y-2 p-4 text-sm">
              <p>{c.staleList}</p>
              <p>
                {meetingText(c.snapshot, {
                  time: displayMeetingTime(meetingsQuery.dataUpdatedAt, locale),
                })}
              </p>
              <Button
                variant="outline"
                onClick={() => void meetingsQuery.refetch()}
              >
                {c.retry}
              </Button>
            </div>
          )}
          {meetingsQuery.isLoading ? (
            <div
              className="space-y-px bg-border"
              role="status"
              aria-label={c.loadingList}
            >
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-20 rounded-none" />
              ))}
            </div>
          ) : meetingsQuery.isError && !meetingsQuery.data ? (
            <InlineError
              title={c.listError}
              onRetry={() => void meetingsQuery.refetch()}
            />
          ) : meetings.length === 0 ? (
            <div className="px-4 py-8 text-center">
              <ClipboardList
                className="mx-auto text-muted-foreground"
                size={22}
              />
              <p className="mt-3 text-xs font-bold">{c.emptyTitle}</p>
              <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                {c.emptyHelp}
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-4"
                onClick={openCreateForm}
              >
                {c.firstMeeting}
              </Button>
            </div>
          ) : (
            <div className="p-2">
              {meetings.map(({ meeting, participantCount }) => (
                <MeetingListButton
                  key={meeting.id}
                  meeting={meeting}
                  participantCount={participantCount}
                  selected={meeting.id === selectedMeetingId}
                  onSelect={() => setSelectedMeetingId(meeting.id)}
                />
              ))}
            </div>
          )}
        </aside>

        <div className="min-w-0">
          {detailQuery.isError && detailQuery.data && (
            <div role="alert" className="space-y-2 p-4 text-sm">
              <p>{c.staleDetail}</p>
              <p>
                {meetingText(c.snapshot, {
                  time: displayMeetingTime(detailQuery.dataUpdatedAt, locale),
                })}
              </p>
              <Button
                variant="outline"
                onClick={() => void detailQuery.refetch()}
              >
                {c.retry}
              </Button>
            </div>
          )}
          {selectedMeetingId === null ? (
            <div className="flex min-h-[420px] flex-col items-center justify-center px-6 text-center">
              <CalendarDays size={28} className="text-muted-foreground" />
              <p className="mt-3 text-sm font-bold">{c.selectTitle}</p>
              <p className="mt-1 max-w-md text-sm leading-6 text-muted-foreground">
                {c.selectHelp}
              </p>
            </div>
          ) : detailQuery.isLoading ? (
            <MeetingDetailSkeleton />
          ) : !detailQuery.data ? (
            <InlineError
              title={c.detailError}
              onRetry={() => void detailQuery.refetch()}
              roomy
            />
          ) : (
            <MeetingDetailView
              key={selectedMeetingId}
              writeBlocked={writeBlocked}
              detail={detailQuery.data}
              agents={members}
              transcriptDraft={transcriptDraft}
              onTranscriptDraftChange={setTranscriptDraft}
              onAddTranscript={() => {
                const content = transcriptDraft.trim();
                if (content)
                  return meetingTurn.mutateAsync({
                    meetingId: detailQuery.data.meeting.id,
                    prompt: content,
                    participantAgentIds: detailQuery.data.participants.map(
                      (p) => p.agentId,
                    ),
                  });
                return undefined;
              }}
              transcriptPending={
                meetingTurn.isPending &&
                meetingTurn.variables?.meetingId === selectedMeetingId
              }
              turnBlocked={
                Boolean(pendingTurn.intent) ||
                pendingTurn.error ||
                !turnCopy.data
              }
              decisionDraft={decisionDraft}
              decisionOwnerId={decisionOwnerId}
              onDecisionDraftChange={setDecisionDraft}
              onDecisionOwnerChange={setDecisionOwnerId}
              onAddDecision={() => {
                const content = decisionDraft.trim();
                if (content)
                  return decisionMutation.mutateAsync({
                    meetingId: detailQuery.data.meeting.id,
                    content,
                    ownerAgentId: decisionOwnerId,
                  });
                return undefined;
              }}
              decisionPending={decisionMutation.isPending}
              actionDraft={actionDraft}
              actionOwnerId={actionOwnerId}
              onActionDraftChange={setActionDraft}
              onActionOwnerChange={setActionOwnerId}
              onAddAction={() => {
                const actionTitle = actionDraft.trim();
                if (actionTitle)
                  return actionMutation.mutateAsync({
                    meetingId: detailQuery.data.meeting.id,
                    title: actionTitle,
                    ownerAgentId: actionOwnerId,
                  });
                return undefined;
              }}
              actionPending={actionMutation.isPending}
              onToggleAction={(actionItemId, status) =>
                actionStatusMutation.mutate({
                  actionItemId,
                  status,
                  meetingId: detailQuery.data.meeting.id,
                })
              }
              actionTogglePendingId={
                actionStatusMutation.isPending
                  ? (actionStatusMutation.variables?.actionItemId ?? null)
                  : null
              }
              completionSummary={completionSummary}
              onCompletionSummaryChange={setCompletionSummary}
              onStart={() => startMeeting.mutate(detailQuery.data)}
              startPending={
                startMeeting.isPending &&
                startMeeting.variables?.meeting.id === selectedMeetingId
              }
              onComplete={() =>
                completeMeeting.mutateAsync({
                  meetingId: detailQuery.data.meeting.id,
                  summary: completionSummary.trim(),
                })
              }
              completePending={completeMeeting.isPending}
            />
          )}
        </div>
      </div>
    </section>
  );
}

function ParticipantPicker({
  error,
  agents,
  selectedIds,
  onToggle,
  disabled,
}: {
  error?: string;
  agents: Agent[];
  selectedIds: number[];
  onToggle: (agentId: number) => void;
  disabled: boolean;
}) {
  const { c } = useMeetingCopy();
  return (
    <fieldset
      id="meeting-participant-picker"
      tabIndex={-1}
      aria-invalid={Boolean(error)}
      aria-describedby="meeting-participants-error"
      className="min-w-0 rounded-2xl border border-border/70 bg-background/35 p-3"
    >
      <legend className="px-1 text-xs font-semibold">{c.participants}</legend>
      <p className="mb-2 text-[12px] leading-5 text-muted-foreground">
        {c.participantsHelp}
      </p>
      {agents.length === 0 ? (
        <p className="border border-dashed border-border px-3 py-5 text-center text-xs text-muted-foreground">
          {c.noAgents}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {agents.map((agent) => {
            const selected = selectedIds.includes(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                aria-pressed={selected}
                disabled={disabled}
                onClick={() => onToggle(agent.id)}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-xl border px-2 py-2 text-start transition-colors duration-300",
                  selected
                    ? "border-primary bg-primary/[0.06]"
                    : "border-transparent hover:border-border hover:bg-background",
                )}
              >
                <AgentAvatar agent={agent} size="xs" showStatus />
                <span className="min-w-0 flex-1">
                  <span className="block break-words text-[12px] [overflow-wrap:anywhere] font-semibold">
                    {agent.name}
                  </span>
                  <span className="block break-words text-[12px] [overflow-wrap:anywhere] text-muted-foreground">
                    {agent.role}
                  </span>
                </span>
                <span
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    selected
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-transparent",
                  )}
                >
                  <Check size={11} aria-hidden />
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p
        id="meeting-participants-error"
        role={error ? "alert" : undefined}
        className="mt-2 text-sm text-destructive"
      >
        {error}
      </p>
      {selectedIds
        .filter((id) => !agents.some((a) => a.id === id))
        .map((id) => (
          <Button
            type="button"
            key={id}
            variant="outline"
            onClick={() => onToggle(id)}
            disabled={disabled}
          >
            {c.agent} #{id} <X aria-hidden size={14} />
          </Button>
        ))}
    </fieldset>
  );
}

function MeetingListButton({
  meeting,
  participantCount,
  selected,
  onSelect,
}: {
  meeting: ProjectMeeting;
  participantCount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { c, locale } = useMeetingCopy();
  const status = MEETING_STATUS[meeting.status];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "mb-1 flex w-full items-start gap-2 rounded-xl border px-3 py-3 text-start transition-colors duration-300 last:mb-0",
        selected
          ? "border-primary bg-primary/[0.055]"
          : "border-transparent hover:border-border hover:bg-card",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block break-words text-sm font-semibold [overflow-wrap:anywhere]">
          {meeting.title}
        </span>
        <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5",
              status.className,
            )}
          >
            {c[meeting.status]}
          </span>
          <span>
            {meetingText(c.countParticipants, {
              count: meetingNumber(participantCount, locale),
            })}
          </span>
          <span>{displayMeetingTime(meeting.updatedAt, locale)}</span>
        </span>
      </span>
      <ChevronRight
        size={13}
        className="mt-0.5 shrink-0 text-muted-foreground rtl:rotate-180"
      />
    </button>
  );
}

function MeetingDetailView({
  detail,
  agents,
  transcriptDraft,
  onTranscriptDraftChange,
  onAddTranscript,
  transcriptPending,
  turnBlocked,
  writeBlocked,
  decisionDraft,
  decisionOwnerId,
  onDecisionDraftChange,
  onDecisionOwnerChange,
  onAddDecision,
  decisionPending,
  actionDraft,
  actionOwnerId,
  onActionDraftChange,
  onActionOwnerChange,
  onAddAction,
  actionPending,
  onToggleAction,
  actionTogglePendingId,
  completionSummary,
  onCompletionSummaryChange,
  onStart,
  startPending,
  onComplete,
  completePending,
}: {
  detail: ProjectMeetingDetail;
  agents: Agent[];
  transcriptDraft: string;
  onTranscriptDraftChange: (value: string) => void;
  onAddTranscript: () => void | Promise<unknown>;
  transcriptPending: boolean;
  turnBlocked: boolean;
  writeBlocked: boolean;
  decisionDraft: string;
  decisionOwnerId: number | null;
  onDecisionDraftChange: (value: string) => void;
  onDecisionOwnerChange: (value: number | null) => void;
  onAddDecision: () => void | Promise<unknown>;
  decisionPending: boolean;
  actionDraft: string;
  actionOwnerId: number | null;
  onActionDraftChange: (value: string) => void;
  onActionOwnerChange: (value: number | null) => void;
  onAddAction: () => void | Promise<unknown>;
  actionPending: boolean;
  onToggleAction: (actionItemId: number, status: "open" | "done") => void;
  actionTogglePendingId: number | null;
  completionSummary: string;
  onCompletionSummaryChange: (value: string) => void;
  onStart: () => void;
  startPending: boolean;
  onComplete: () => void | Promise<unknown>;
  completePending: boolean;
}) {
  const { c, locale } = useMeetingCopy();
  const { meeting } = detail;
  const status = MEETING_STATUS[meeting.status];
  const editable = meeting.status === "in_progress";
  const startable =
    meeting.status === "draft" || meeting.status === "scheduled";
  const agentsById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const ownerOptions = useMemo(
    () =>
      detail.participants.map((participant) => ({
        id: participant.agentId,
        name: agentsById.get(participant.agentId)?.name ?? participant.name,
      })),
    [agentsById, detail.participants],
  );

  return (
    <article aria-labelledby={`meeting-${meeting.id}-title`}>
      <header className="border-b border-border/60 px-4 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[12px] font-bold",
                  status.className,
                )}
              >
                {c[meeting.status]}
              </span>
              <span className="font-mono text-[12px] text-muted-foreground">
                {meetingText(c.identity, {
                  meeting: meeting.id,
                  project: meeting.taskId,
                })}
              </span>
            </div>
            <h3
              dir="auto"
              id={`meeting-${meeting.id}-title`}
              className="mt-2 break-words text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]"
            >
              {meeting.title}
            </h3>
            {meeting.agenda ? (
              <p
                dir="auto"
                className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]"
              >
                {meeting.agenda}
              </p>
            ) : null}
          </div>
          {startable ? (
            <Button
              type="button"
              size="sm"
              onClick={onStart}
              disabled={startPending || turnBlocked || writeBlocked}
              aria-busy={startPending}
            >
              {startPending ? (
                <RefreshCw size={13} className="animate-spin" />
              ) : (
                <Play size={13} />
              )}
              {startPending ? c.starting : c.start}
            </Button>
          ) : null}
        </div>

        <div
          className="mt-4 flex flex-wrap items-center gap-2"
          aria-label={c.participants}
        >
          {detail.participants.length ? (
            detail.participants.map((participant) => {
              const agent = agentsById.get(participant.agentId);
              return (
                <div
                  key={participant.agentId}
                  className="flex min-w-0 max-w-full items-center gap-2 rounded-full border border-border/70 bg-background/50 px-2 py-1.5"
                >
                  {agent ? (
                    <AgentAvatar agent={agent} size="xs" showStatus />
                  ) : (
                    <span
                      className="flex size-6 items-center justify-center text-[12px] font-bold text-white"
                      style={{
                        backgroundColor: participant.avatarColor ?? "#315bff",
                      }}
                    >
                      {participant.name.slice(0, 1).toLocaleUpperCase(locale)}
                    </span>
                  )}
                  <span
                    dir="auto"
                    className="min-w-0 break-words text-[12px] font-semibold [overflow-wrap:anywhere]"
                  >
                    {participant.name}
                  </span>
                </div>
              );
            })
          ) : (
            <span className="text-[12px] text-muted-foreground">
              {c.noParticipants}
            </span>
          )}
        </div>

        {editable ? (
          <RecordComposer
            label={c.summary}
            value={completionSummary}
            onChange={onCompletionSummaryChange}
            onSubmit={onComplete}
            pending={completePending}
            blocked={writeBlocked}
            buttonLabel={c.complete}
            limit={30000}
          />
        ) : meeting.summary ? (
          <div className="mt-4 border-t border-border/60 pt-4">
            <p className="flex items-center gap-2 text-[12px] font-bold">
              <CheckCircle2 size={13} className="text-primary" aria-hidden />
              {c.summary}
            </p>
            <p
              dir="auto"
              className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]"
            >
              {meeting.summary}
            </p>
          </div>
        ) : null}
      </header>

      <p className="px-4 py-3 text-sm text-muted-foreground">{c.recordsHelp}</p>
      <div className="grid gap-px bg-border/60 xl:grid-cols-3">
        <MeetingRecordColumn
          icon={MessageSquareText}
          title={c.transcript}
          count={detail.transcript.length}
        >
          {detail.transcript.length ? (
            detail.transcript.map((entry) => (
              <div
                key={entry.id}
                className="border-b border-border/60 px-4 py-4 last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                  <strong className="text-foreground">
                    {entry.speakerName ??
                      (entry.speakerType === "founder" ? c.founder : c.agent)}
                  </strong>
                  <time dateTime={entry.occurredAt}>
                    {displayMeetingTime(entry.occurredAt, locale)}
                  </time>
                </div>
                <p
                  dir="auto"
                  className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]"
                >
                  {entry.content}
                </p>
              </div>
            ))
          ) : (
            <ColumnEmpty text={c.emptyTranscript} />
          )}
          {editable ? (
            <RecordComposer
              label={c.messageLabel}
              value={transcriptDraft}
              onChange={onTranscriptDraftChange}
              onSubmit={onAddTranscript}
              pending={transcriptPending}
              blocked={turnBlocked || writeBlocked}
              buttonLabel={c.nextTurn}
            />
          ) : null}
        </MeetingRecordColumn>

        <MeetingRecordColumn
          icon={Scale}
          title={c.decisions}
          count={detail.decisions.length}
        >
          {detail.decisions.length ? (
            detail.decisions.map((decision) => (
              <div
                key={decision.id}
                className="border-b border-border/60 px-4 py-4 last:border-b-0"
              >
                <p
                  dir="auto"
                  className="break-words text-sm font-semibold leading-6 [overflow-wrap:anywhere]"
                >
                  {decision.content}
                </p>
                {decision.rationale ? (
                  <p
                    dir="auto"
                    className="mt-1 break-words text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]"
                  >
                    {decision.rationale}
                  </p>
                ) : null}
                <p className="mt-2 text-[12px] text-muted-foreground">
                  {decision.ownerName
                    ? meetingText(c.owner, { name: decision.ownerName })
                    : c.sharedDecision}
                </p>
              </div>
            ))
          ) : (
            <ColumnEmpty text={c.emptyDecisions} />
          )}
          {editable ? (
            <RecordComposer
              label={c.decisionLabel}
              value={decisionDraft}
              onChange={onDecisionDraftChange}
              onSubmit={onAddDecision}
              pending={decisionPending}
              blocked={writeBlocked}
              buttonLabel={c.addDecision}
              ownerId={decisionOwnerId}
              onOwnerChange={onDecisionOwnerChange}
              ownerOptions={ownerOptions}
            />
          ) : null}
        </MeetingRecordColumn>

        <MeetingRecordColumn
          icon={ListTodo}
          title={c.actions}
          count={detail.actionItems.length}
        >
          {detail.actionItems.length ? (
            detail.actionItems.map((action) => (
              <div
                key={action.id}
                className="border-b border-border/60 px-4 py-4 last:border-b-0"
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    aria-pressed={action.status === "done"}
                    aria-label={
                      action.status === "done"
                        ? meetingText(c.actionReopen, { title: action.title })
                        : meetingText(c.actionComplete, { title: action.title })
                    }
                    disabled={actionTogglePendingId !== null || writeBlocked}
                    aria-busy={actionTogglePendingId === action.id}
                    onClick={() =>
                      onToggleAction(
                        action.id,
                        action.status === "done" ? "open" : "done",
                      )
                    }
                    className={cn(
                      "mt-0.5 flex size-11 shrink-0 items-center justify-center border transition-colors disabled:cursor-wait disabled:opacity-50",
                      action.status === "done"
                        ? "border-emerald-500 bg-emerald-500 text-white"
                        : "border-border text-muted-foreground hover:border-primary",
                    )}
                  >
                    <Check size={10} />
                  </button>
                  <div className="min-w-0">
                    <p
                      dir="auto"
                      className="break-words text-sm font-semibold leading-6 [overflow-wrap:anywhere]"
                    >
                      {action.title}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {
                        c[
                          `action_${action.status}` as
                            | "action_open"
                            | "action_in_progress"
                            | "action_done"
                            | "action_cancelled"
                        ]
                      }
                    </p>
                    {action.details ? (
                      <p
                        dir="auto"
                        className="mt-1 break-words text-[12px] leading-5 text-muted-foreground [overflow-wrap:anywhere]"
                      >
                        {action.details}
                      </p>
                    ) : null}
                    <p className="mt-2 text-[12px] text-muted-foreground">
                      {action.ownerName
                        ? meetingText(c.owner, { name: action.ownerName })
                        : c.unassigned}
                    </p>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <ColumnEmpty text={c.emptyActions} />
          )}
          {editable ? (
            <RecordComposer
              label={c.actionLabel}
              limit={500}
              value={actionDraft}
              onChange={onActionDraftChange}
              onSubmit={onAddAction}
              pending={actionPending}
              blocked={writeBlocked}
              buttonLabel={c.addAction}
              ownerId={actionOwnerId}
              onOwnerChange={onActionOwnerChange}
              ownerOptions={ownerOptions}
            />
          ) : null}
        </MeetingRecordColumn>
      </div>
    </article>
  );
}

function MeetingRecordColumn({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof MessageSquareText;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const { locale } = useMeetingCopy();
  return (
    <section className="min-w-0 bg-card">
      <header className="flex items-center justify-between border-b border-border/60 px-4 py-3.5">
        <h4 className="flex items-center gap-2 text-xs font-bold">
          <Icon size={13} className="text-primary" /> {title}
        </h4>
        <span className="font-mono text-[12px] text-muted-foreground">
          {meetingNumber(count, locale)}
        </span>
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function RecordComposer({
  label,
  value,
  onChange,
  onSubmit,
  pending,
  blocked = false,
  buttonLabel,
  ownerId,
  onOwnerChange,
  ownerOptions,
  limit = 12000,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<unknown>;
  pending: boolean;
  blocked?: boolean;
  buttonLabel: string;
  ownerId?: number | null;
  onOwnerChange?: (value: number | null) => void;
  ownerOptions?: Array<{ id: number; name: string }>;
  limit?: number;
}) {
  const { c, locale } = useMeetingCopy();
  const [failed, setFailed] = useState(false);
  const schema = useMemo(
    () =>
      z.object({
        text: z
          .string()
          .check(
            z.trim(),
            z.minLength(1, c.required),
            z.maxLength(
              limit,
              meetingText(c.tooLong, { count: meetingNumber(limit, locale) }),
            ),
          ),
        ownerId: z
          .nullable(z.number())
          .check(
            z.refine(
              (id) =>
                id === null || Boolean(ownerOptions?.some((o) => o.id === id)),
              c.rosterChanged,
            ),
          ),
      }),
    [c, locale, limit, ownerOptions],
  );
  const form = useForm<{ text: string; ownerId: number | null }>({
    resolver: zodResolver(schema),
    values: { text: value, ownerId: ownerId ?? null },
    resetOptions: { keepErrors: true, keepTouched: true },
    mode: "onTouched",
  });
  const busy = pending || form.formState.isSubmitting;
  const id = useId(),
    help = id + "-help",
    error = id + "-error",
    ownerError = id + "-owner-error";
  const textField = form.register("text");
  // A Radix trigger is a button, whose native value is a string. Controlled
  // registration keeps owner IDs numeric when the trigger blurs.
  const { field: ownerField } = useController({
    control: form.control,
    name: "ownerId",
  });
  return (
    <ValidatedForm
      form={form}
      aria-busy={busy}
      onSubmit={async () => {
        if (pending || blocked) return;
        setFailed(false);
        try {
          await onSubmit();
        } catch {
          setFailed(true);
        }
      }}
      className="space-y-2 border-t border-border/60 p-4"
    >
      <label className="block text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      <Textarea
        {...textField}
        id={id}
        value={value}
        onChange={(event) => {
          void textField.onChange(event);
          onChange(event.target.value);
        }}
        rows={3}
        maxLength={limit}
        disabled={busy}
        aria-invalid={Boolean(form.formState.errors.text)}
        aria-describedby={error}
        className="min-h-24 resize-y bg-card text-sm"
      />
      <p
        id={error}
        role={form.formState.errors.text ? "alert" : undefined}
        className="text-sm text-destructive"
      >
        {form.formState.errors.text?.message}
      </p>
      {ownerOptions && onOwnerChange && (
        <>
          <label className="block text-sm" id={id + "-owner-label"}>
            {meetingText(c.ownerLabel, { label })}
          </label>
          <Select
            dir={locale === "ar" ? "rtl" : "ltr"}
            value={
              ownerId === null || ownerId === undefined
                ? "none"
                : String(ownerId)
            }
            disabled={busy}
            onValueChange={(value) => {
              const id = value === "none" ? null : Number(value);
              ownerField.onChange(id);
              onOwnerChange(id);
            }}
          >
            <SelectTrigger
              ref={ownerField.ref}
              onBlur={ownerField.onBlur}
              name={ownerField.name}
              aria-labelledby={id + "-owner-label"}
              aria-describedby={help + " " + ownerError}
              aria-invalid={Boolean(form.formState.errors.ownerId)}
              className="min-h-11 whitespace-normal"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none" className="min-h-11">
                {c.noneOwner}
              </SelectItem>
              {ownerOptions.map((o) => (
                <SelectItem
                  key={o.id}
                  value={String(o.id)}
                  className="min-h-11"
                >
                  {o.name}
                </SelectItem>
              ))}
              {ownerId && !ownerOptions.some((o) => o.id === ownerId) && (
                <SelectItem value={String(ownerId)} disabled>
                  {c.agent} #{ownerId}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <p id={help} className="text-sm text-muted-foreground">
            {ownerOptions.length === 0
              ? meetingText(c.emptyRoster, { label })
              : null}
          </p>
          <p
            id={ownerError}
            role={form.formState.errors.ownerId ? "alert" : undefined}
            className="text-sm text-destructive"
          >
            {form.formState.errors.ownerId?.message}
          </p>
        </>
      )}
      {failed && (
        <p role="alert" className="text-sm text-destructive">
          {c.saveError}
        </p>
      )}
      <Button
        type="submit"
        variant="outline"
        className="min-h-11 w-full whitespace-normal"
        disabled={busy || blocked}
        aria-busy={busy}
      >
        {busy ? (
          <RefreshCw size={14} className="animate-spin" aria-hidden />
        ) : (
          <Plus size={14} aria-hidden />
        )}
        {busy ? c.saving : buttonLabel}
      </Button>
    </ValidatedForm>
  );
}

function meetingNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale).format(value);
}

function displayMeetingTime(value: string | number, locale: Locale) {
  return (
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Europe/Istanbul",
    }).format(new Date(value)) + " · Europe/Istanbul"
  );
}

function ColumnEmpty({ text }: { text: string }) {
  return (
    <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
      {text}
    </p>
  );
}

function InlineError({
  title,
  onRetry,
  roomy = false,
}: {
  title: string;
  onRetry: () => void;
  roomy?: boolean;
}) {
  const { c } = useMeetingCopy();
  return (
    <div
      className={cn(
        "px-4 py-6 text-center",
        roomy && "flex min-h-[420px] flex-col items-center justify-center",
      )}
      role="alert"
    >
      <CircleAlert size={20} className="mx-auto text-rose-500" />
      <p className="mt-2 text-xs font-bold">{title}</p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="mt-3"
        onClick={onRetry}
      >
        {c.retry}
      </Button>
    </div>
  );
}

function MeetingDetailSkeleton() {
  const { c } = useMeetingCopy();
  return (
    <div
      className="space-y-px bg-border"
      role="status"
      aria-label={c.loadingDetail}
    >
      <Skeleton className="h-36 rounded-none" />
      <div className="grid gap-px lg:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <Skeleton key={item} className="h-72 rounded-none" />
        ))}
      </div>
    </div>
  );
}
