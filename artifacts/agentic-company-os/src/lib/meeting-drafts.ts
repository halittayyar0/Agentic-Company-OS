export type MeetingDraft = {
  transcriptDraft: string;
  decisionDraft: string;
  decisionOwnerId: number | null;
  actionDraft: string;
  actionOwnerId: number | null;
  completionSummary: string;
};
export type MeetingDraftSession = {
  version: 1;
  projectId: number;
  selectedMeetingId: number | null;
  createOpen: boolean;
  title: string;
  agenda: string;
  participantIds: number[] | null;
  drafts: Record<number, MeetingDraft>;
};
export type MeetingDraftSnapshot = {
  session: MeetingDraftSession;
  damaged: boolean;
  storageError: boolean;
};
type Store = Pick<Storage, "getItem" | "setItem">;
export const emptyMeetingDraft: MeetingDraft = {
  transcriptDraft: "",
  decisionDraft: "",
  decisionOwnerId: null,
  actionDraft: "",
  actionOwnerId: null,
  completionSummary: "",
};
export const meetingDraftKey = (id: number) => `acos.meeting-drafts.v1:${id}`;
export function emptyMeetingSession(projectId: number): MeetingDraftSession {
  return {
    version: 1,
    projectId,
    selectedMeetingId: null,
    createOpen: false,
    title: "",
    agenda: "",
    participantIds: null,
    drafts: {},
  };
}
const positive = (v: unknown) =>
  typeof v === "number" && Number.isInteger(v) && v > 0 && v <= 2147483647;
const owner = (v: unknown) => v === null || positive(v);
const text = (v: unknown, max: number) =>
  typeof v === "string" && v.length <= max;
function validSession(
  value: unknown,
  projectId: number,
): value is MeetingDraftSession {
  const s = value as MeetingDraftSession | null;
  return Boolean(
    s &&
    s.version === 1 &&
    positive(projectId) &&
    s.projectId === projectId &&
    owner(s.selectedMeetingId) &&
    typeof s.createOpen === "boolean" &&
    text(s.title, 200) &&
    text(s.agenda, 12000) &&
    (s.participantIds === null ||
      (Array.isArray(s.participantIds) &&
        s.participantIds.length <= 2000 &&
        s.participantIds.every(positive) &&
        new Set(s.participantIds).size === s.participantIds.length)) &&
    s.drafts &&
    typeof s.drafts === "object" &&
    !Array.isArray(s.drafts) &&
    Object.keys(s.drafts).length <= 200 &&
    Object.entries(s.drafts).every(
      ([id, d]) =>
        /^[1-9]\d*$/.test(id) &&
        positive(Number(id)) &&
        d &&
        text(d.transcriptDraft, 12000) &&
        text(d.decisionDraft, 12000) &&
        text(d.actionDraft, 500) &&
        text(d.completionSummary, 30000) &&
        owner(d.decisionOwnerId) &&
        owner(d.actionOwnerId),
    ),
  );
}
export function readMeetingDrafts(
  projectId: number,
  storage: Store,
): MeetingDraftSnapshot {
  const empty = emptyMeetingSession(projectId);
  try {
    const raw = storage.getItem(meetingDraftKey(projectId));
    if (raw === null)
      return { session: empty, damaged: false, storageError: false };
    if (raw.length > 2_000_000) throw Error();
    const session: unknown = JSON.parse(raw);
    if (!validSession(session, projectId)) throw Error();
    return {
      session: session as MeetingDraftSession,
      damaged: false,
      storageError: false,
    };
  } catch {
    return { session: empty, damaged: true, storageError: true };
  }
}
export function writeMeetingDrafts(
  session: MeetingDraftSession,
  storage: Store,
): boolean {
  try {
    if (!validSession(session, session.projectId)) return false;
    const raw = JSON.stringify(session);
    if (raw.length > 2_000_000) return false;
    storage.setItem(meetingDraftKey(session.projectId), raw);
    return storage.getItem(meetingDraftKey(session.projectId)) === raw;
  } catch {
    return false;
  }
}

const snapshots = new Map<number, MeetingDraftSnapshot>();
const listeners = new Map<number, Set<() => void>>();
let unloadGuard = false;
export function getMeetingDrafts(projectId: number): MeetingDraftSnapshot {
  let snapshot = snapshots.get(projectId);
  if (!snapshot) {
    try {
      snapshot = readMeetingDrafts(projectId, window.sessionStorage);
    } catch {
      snapshot = {
        session: emptyMeetingSession(projectId),
        damaged: true,
        storageError: true,
      };
    }
    snapshots.set(projectId, snapshot);
  }
  if (!unloadGuard && typeof window !== "undefined") {
    window.addEventListener("beforeunload", (event) => {
      if ([...snapshots.values()].some((s) => s.storageError)) {
        event.preventDefault();
        event.returnValue = "";
      }
    });
    unloadGuard = true;
  }
  return snapshot;
}
export function updateMeetingDrafts(
  projectId: number,
  update: (s: MeetingDraftSession) => MeetingDraftSession,
  reset = false,
) {
  const current = getMeetingDrafts(projectId),
    session = update(current.session);
  if (session === current.session) return;
  let stored = false;
  if (!current.damaged || reset) {
    try {
      stored = writeMeetingDrafts(session, window.sessionStorage);
    } catch {
      /* memory still retains unsaved text */
    }
  }
  snapshots.set(projectId, {
    session,
    damaged: current.damaged && !(reset && stored),
    storageError: !stored,
  });
  for (const listener of listeners.get(projectId) ?? []) listener();
}
export function subscribeMeetingDrafts(
  projectId: number,
  listener: () => void,
) {
  const group = listeners.get(projectId) ?? new Set();
  group.add(listener);
  listeners.set(projectId, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(projectId);
  };
}
