import type {
  CompanyChannelMember,
  CompanyChannelMemberInput,
  CompanyMessageInput,
  CompanyMessageResponse,
  CompanyMessage,
} from "@workspace/api-client-react";

import { controlPlaneFetch } from "@/lib/auth";
import { sendCompanyMessage } from "@workspace/api-client-react";

export type { CompanyChannelMember, CompanyMessage };

export type SendCompanyRoomMessageInput = Pick<
  CompanyMessageInput,
  "content" | "mentionedAgentIds" | "requestId" | "locale"
>;

export type SendCompanyRoomMessageResult = CompanyMessageResponse;

export const companyRoomMembersQueryKey = ["company-chat", "members"] as const;

export function listCompanyRoomMembers(): Promise<CompanyChannelMember[]> {
  return controlPlaneFetch("/api/company-chat/members");
}

export function addCompanyRoomMember(
  agentId: number,
): Promise<CompanyChannelMember> {
  return controlPlaneFetch("/api/company-chat/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId } satisfies CompanyChannelMemberInput),
  });
}

export function removeCompanyRoomMember(agentId: number): Promise<void> {
  return controlPlaneFetch(`/api/company-chat/members/${agentId}`, {
    method: "DELETE",
  });
}

export function sendCompanyRoomMessage(
  input: SendCompanyRoomMessageInput,
): Promise<SendCompanyRoomMessageResult> {
  return sendCompanyMessage(input);
}
