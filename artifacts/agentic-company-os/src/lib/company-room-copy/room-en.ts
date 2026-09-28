import type { CompanyRoomCopy } from "../company-room-copy";
export default {
  title: "Company room",
  eyebrow: "Shared memory",
  description:
    "A persistent conversation for your team. Manage members, mention experts, and keep decisions together.",
  members: "Room members",
  memberRegion: "Company room members",
  activeMembers: "Active members",
  rosterHelp:
    "Membership and reply budgets are separate. Agents may be busy or choose not to reply.",
  openChat: "Open expert chat",
  join: "Add to room",
  leave: "Remove from room",
  inactive: "Inactive",
  memberAdded: "Member added",
  memberRemoved: "Member removed",
  memberError:
    "Membership could not be confirmed. Refresh the roster before trying again.",
  rosterError: "The member list could not be loaded.",
  rosterStale:
    "The roster could not be refreshed. Sending and membership changes are paused.",
  noAgents: "No experts available",
  noMembers: "No members yet",
  loadingMembers: "Loading room members",
  loadingMessages: "Loading room messages",
  messagesError: "The room could not be loaded.",
  messagesStale:
    "The last loaded conversation is shown. Refresh before sending.",
  empty: "The room is quiet",
  emptyHelp:
    "Write a message or mention a member with @. Messages retain their recorded sender identity.",
  firstMessage: "Write the first message",
  retry: "Refresh",
  older: "Load older messages",
  newMessages: "Go to latest messages",
  loadedMessages: "Loaded messages",
  founder: "Operator",
  agent: "Expert",
  roomReply: "Room reply",
  projectNote: "Project note",
  operatorMessage: "Operator message",
  project: "Project",
  source: "Messages and custom identities stay in their original language.",
  skipped: "Reply status",
  busy: "busy with other work",
  unavailable: "unavailable",
  empty_response: "produced no reply",
  model_error: "reply could not be generated",
  not_relevant: "had no contribution",
  not_mentioned: "was not mentioned",
  budget_guard: "skipped by the reply budget",
  close: "Dismiss",
  compose: "Message to the company room",
  placeholder: "Write a message; use @ to mention a member",
  send: "Send to company room",
  sending: "Saving message and waiting for replies…",
  mentionMembers: "Room members to mention",
  removeMention: "Remove mention",
  noMatches: "No matching active member",
  mentionedHelp:
    "Only the active members you mention are considered for replies.",
  ambientHelp:
    "Without mentions, members assess the message; only those with a contribution reply.",
  invalidMention:
    "A mentioned member left or changed identity. Review the draft before sending.",
  stored: "Message recorded",
  storedHelp:
    "The bounded reply round finished. Skipped members did not provide a reply.",
  unconfirmed:
    "Your message was saved, but all replies are not confirmed. Check the live conversation; recovery does not restart the round.",
  unknown:
    "The send result is unknown. Recover this same send before writing another message.",
  recover: "Recover send",
  storageError:
    "The browser could not save recovery information. Free session storage and try again.",
  conflict:
    "This send identity belongs to different content. Keep your draft and check the room before starting a new send.",
  invalid: "The request was rejected. Review the message and members.",
  capacity: "The room message limit was reached.",
  stopped:
    "Emergency stop is active. New messages are paused; existing sends can still be recovered.",
  safetyUnknown: "Safety status could not be checked. New messages are paused.",
  pendingHelp:
    "A send is awaiting recovery. Its text, recipients and language are held unchanged.",
  newSend: "Write another message",
} satisfies CompanyRoomCopy;
