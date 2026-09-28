import type { Page, Route } from "@playwright/test";
import { AGENT_TEMPLATES } from "../../../artifacts/api-server/src/lib/agent-templates";
import { getLocalizedAgentTemplates } from "../../../artifacts/api-server/src/lib/agent-template-localization";
import { isWorkspaceLocale } from "../../../artifacts/api-server/src/lib/workspace-locale";

const now = "2026-09-04T09:00:00.000Z";
export const studioAgents = AGENT_TEMPLATES.filter(
  (template) => template.key !== "specialist",
).map((template, index) => ({
  id: index + 1,
  configVersion: "a".repeat(64),
  isRootCeo: index === 0,
  name: template.name,
  role: template.defaultRole,
  department: template.department,
  parentAgentId: index === 0 ? null : 1,
  depth: index === 0 ? 0 : 1,
  status: "idle",
  currentTaskId: null,
  currentAction: null,
  lastActiveAt: null,
  systemPrompt: template.defaultSystemPrompt,
  isCustomPrompt: false,
  templateKey: template.key,
  modelMode: "auto",
  modelId: null,
  avatarColor: "#665bae",
  avatarVersion: null,
  permissions: template.defaultPermissions,
  createdByAgentId: index === 0 ? null : 1,
  createdByUser: index === 0,
  isActive: true,
  createdAt: now,
  updatedAt: now,
}));

export async function installStudioFixtures(page: Page) {
  const requests: Array<{ path: string; body: unknown }> = [];
  const unexpected = new Set<string>();
  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/status")
      return json(route, {
        enabled: false,
        authenticated: true,
        sessionExpiresAt: null,
      });
    if (path === "/api/settings/locale" && request.method() === "PUT")
      return json(route, request.postDataJSON());
    if (path === "/api/ops/control")
      return json(route, {
        emergencyStopEnabled: false,
        reason: null,
        version: 1,
        updatedBy: "test",
        updatedAt: now,
        blockedScopes: [],
      });
    if (path === "/api/healthz") return json(route, { status: "ok" });
    if (path === "/api/org/summary")
      return json(route, {
        totalAgents: studioAgents.length,
        activeAgents: studioAgents.length,
        workingAgents: 0,
        tasksInProgress: 0,
        tasksAwaitingApproval: 0,
        tasksCompletedToday: 0,
        pendingApprovals: 0,
        tokensUsedToday: 0,
        estimatedCostTodayUsd: 0,
        usageEventsToday: 0,
        costReportedEventsToday: 0,
      });
    if (
      request.method() === "POST" &&
      ["/api/tasks", "/api/agents"].includes(path)
    ) {
      requests.push({ path, body: request.postDataJSON() });
      return json(
        route,
        { error: "Bağlantı kesildi. Yeniden deneyebilirsin." },
        503,
      );
    }
    if (path === "/api/agents") return json(route, studioAgents);
    if (path === "/api/agent-templates") {
      const locale = new URL(request.url()).searchParams.get("locale") ?? "tr";
      return json(
        route,
        isWorkspaceLocale(locale)
          ? getLocalizedAgentTemplates(locale)
          : { error: "Invalid locale" },
        isWorkspaceLocale(locale) ? 200 : 400,
      );
    }
    if (path === "/api/model-catalog")
      return json(route, { providers: [], models: [] });
    if (["/api/tasks", "/api/activity", "/api/approvals"].includes(path))
      return json(route, []);
    unexpected.add(`${request.method()} ${path}`);
    return json(route, { error: `Unexpected fixture request: ${path}` }, 501);
  });
  return { requests, unexpected };
}
