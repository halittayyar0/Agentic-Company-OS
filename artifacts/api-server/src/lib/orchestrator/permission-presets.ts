import type { AgentPermissions } from "@workspace/db";

export const managerPermissionsPreset: AgentPermissions = {
  canCreateSubAgents: true,
  canDelegate: true,
  canSpend: false,
  canDelete: false,
  canPublish: false,
  canContactExternal: true,
  canBrowse: true,
  canUseTerminal: true,
  canUseSudo: false,
};

export const specialistPermissionsPreset: AgentPermissions = {
  canCreateSubAgents: false,
  canDelegate: false,
  canSpend: false,
  canDelete: false,
  canPublish: false,
  canContactExternal: false,
  canBrowse: true,
  canUseTerminal: true,
  canUseSudo: false,
};

export const ceoPermissionsPreset: AgentPermissions = {
  canCreateSubAgents: true,
  canDelegate: true,
  canSpend: true,
  canDelete: true,
  canPublish: true,
  canContactExternal: true,
  canBrowse: true,
  canUseTerminal: true,
  canUseSudo: true,
};
