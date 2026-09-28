import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  projectMeetingsTable,
  projectMeetingTurnRequestsTable as requests,
} from "@workspace/db";
import type { RuntimeTransaction } from "./orchestrator/runtime-emergency-stop";

export type MeetingTurnFence = {
  requestId: string;
  leaseOwner: string;
  projectId: number;
  meetingId: number;
};
export const OPEN_MEETING_STATES = ["draft", "scheduled", "in_progress"];

/** Caller holds runtime controls first. Lock order: controls, request, meeting, agent. */
export async function lockLiveMeetingTurn(
  tx: RuntimeTransaction,
  fence: MeetingTurnFence,
) {
  const [request] = await tx
    .select({ id: requests.requestId })
    .from(requests)
    .where(
      and(
        eq(requests.requestId, fence.requestId),
        eq(requests.leaseOwner, fence.leaseOwner),
        eq(requests.projectId, fence.projectId),
        eq(requests.meetingId, fence.meetingId),
        eq(requests.state, "running"),
        sql`${requests.leaseExpiresAt} > clock_timestamp()`,
      ),
    )
    .for("update");
  if (!request) return null;
  const [meeting] = await tx
    .select()
    .from(projectMeetingsTable)
    .where(
      and(
        eq(projectMeetingsTable.id, fence.meetingId),
        eq(projectMeetingsTable.taskId, fence.projectId),
        inArray(projectMeetingsTable.status, OPEN_MEETING_STATES),
      ),
    )
    .for("update");
  return meeting ?? null;
}

export async function readMeetingTurnReceipt(
  projectId: number,
  meetingId: number,
  requestId: string,
) {
  const [row] = await db
    .select({
      request: requests,
      expired: sql<boolean>`${requests.leaseExpiresAt} <= clock_timestamp()`,
    })
    .from(requests)
    .where(
      and(
        eq(requests.requestId, requestId),
        eq(requests.projectId, projectId),
        eq(requests.meetingId, meetingId),
      ),
    );
  if (!row) return null;
  const r = row.request;
  return {
    requestId: r.requestId,
    projectId: r.projectId,
    meetingId: r.meetingId,
    state: r.state === "running" && row.expired ? "unconfirmed" : r.state,
    httpStatus: r.httpStatus,
    response: r.response,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    expiresAt: r.leaseExpiresAt,
  };
}
