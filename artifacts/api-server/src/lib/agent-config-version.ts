import { createHash } from "node:crypto";
import type { Agent } from "@workspace/db";

// Only editable configuration participates. Heartbeats, leases and activity
// must not invalidate a person's draft every time the worker reports progress.
export function agentConfigVersion(agent: Agent): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        "agent-config-v1",
        agent.id,
        agent.name,
        agent.role,
        agent.department,
        agent.parentAgentId,
        agent.depth,
        agent.isRootCeo,
        agent.isActive,
        agent.isCustomPrompt,
        agent.systemPrompt,
        agent.modelMode,
        agent.modelId,
        agent.avatarVersion,
        ...(
          [
            "canCreateSubAgents",
            "canDelegate",
            "canSpend",
            "canDelete",
            "canPublish",
            "canContactExternal",
            "canBrowse",
            "canUseTerminal",
            "canUseSudo",
          ] as const
        ).map((key) => agent.permissions[key]),
      ]),
    )
    .digest("hex");
}
export function withAgentConfigVersion(agent: Agent) {
  return { ...agent, configVersion: agentConfigVersion(agent) };
}
export class AgentConfigChanged extends Error {
  readonly code = "AGENT_CONFIG_CHANGED";
  constructor() {
    super("Agent configuration changed; refresh and review before saving.");
  }
}
export function assertAgentConfig(
  agent: Agent,
  expected: string | undefined,
): void {
  if (expected !== undefined && expected !== agentConfigVersion(agent))
    throw new AgentConfigChanged();
}
