import { expect, test, type Page, type Route } from "@playwright/test";
import { WORKSPACE_LOCALES } from "../../artifacts/api-server/src/lib/workspace-locale";
import { toolMessage } from "../../artifacts/api-server/src/lib/orchestrator/tool-localization";
import { loadProjectStudioCopy } from "../../artifacts/agentic-company-os/src/lib/project-studio-copy";

const QUESTION_ID = "11111111-1111-4111-8111-111111111111";
const NOW = "2026-08-29T09:00:00.000Z";

const owner = {
  id: 7,
  name: "Nova",
  role: "Ürün Direktörü",
  department: "Ürün",
  parentAgentId: 1,
  depth: 1,
  status: "blocked",
  currentTaskId: 501,
  currentAction: "Kurucunun dağıtım kararını bekliyor",
  lastActiveAt: NOW,
  systemPrompt: "Ürün kararlarını ölçülebilir çıktılara dönüştür.",
  isCustomPrompt: false,
  templateKey: "product_director",
  modelMode: "auto",
  modelId: null,
  avatarColor: "#f59e0b",
  avatarVersion: null,
  permissions: {
    canCreateSubAgents: true,
    canDelegate: true,
    canSpend: false,
    canDelete: false,
    canPublish: false,
    canContactExternal: false,
    canBrowse: true,
    canUseTerminal: true,
    canUseSudo: false,
  },
  createdByAgentId: 1,
  createdByUser: false,
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const blockedTask = {
  id: 501,
  title: "Açık kaynak lansman planını tamamla",
  brief: "Dağıtım kanalını netleştir ve lansman işlerini yürüt.",
  status: "blocked",
  priority: "high",
  ownerAgentId: owner.id,
  assignedByAgentId: 1,
  createdByUser: true,
  parentTaskId: null,
  progressPercent: 48,
  tokensUsed: 9320,
  estimatedCostUsd: "0.18",
  resultSummary: null,
  executionModelId: null,
  lastModelId: "minimax/minimax-m3:free",
  lastModelProvider: "openrouter",
  modelFallbackCount: 0,
  autonomyMode: "continuous",
  cadenceSeconds: 3600,
  lastHeartbeatAt: NOW,
  recoveryCount: 1,
  cycleCount: 2,
  lastCycleCompletedAt: NOW,
  lastSteppedAt: NOW,
  stepAttempts: 3,
  consecutiveFailures: 0,
  nextAttemptAt: null,
  lastError:
    "Lansmanı GitHub Releases üzerinden mi, yalnız README duyurusuyla mı başlatmalıyım?",
  blockedReason: "user_input",
  dueAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
};

const projectMessages = [
  {
    id: 81,
    agentId: owner.id,
    role: "agent",
    content: "Dağıtım kanalı kararı proje bağlamında bekleniyor.",
    taskId: blockedTask.id,
    modelId: "minimax/minimax-m3:free",
    createdAt: NOW,
  },
];

const projectActivity = [
  {
    id: 91,
    agentId: owner.id,
    taskId: blockedTask.id,
    type: "task_blocked",
    summary: "Lansman kanalı için operatör kararı bekleniyor",
    detail: {
      actor: "agent",
      phase: "decide",
      surface: "browser",
      status: "blocked",
    },
    severity: "warning",
    createdAt: NOW,
  },
];

const vmStatus = {
  agentId: owner.id,
  workspaceId: `agent-${owner.id}`,
  lifecycle: "ready",
  isolation: "filesystem_sandbox",
  persistent: true,
  processExecutionEnabled: true,
  exists: true,
  cwd: ".",
  totalBytes: 2048,
  fileCount: 4,
  dirCount: 2,
};

const browserView = {
  available: false,
  pngBase64: null,
  url: null,
  title: null,
  visible: false,
  control: {
    owner: "agent",
    leaseId: null,
    leaseExpiresAt: null,
    agentActionInFlight: false,
  },
  width: 1280,
  height: 720,
  note: "Task resume deterministic fixture",
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

async function installResumeMocks(
  page: Page,
  {
    failResume,
    blockedReason = "user_input",
    lastError = blockedTask.lastError,
    budgetDenied = false,
    budgetPartial = false,
  }: {
    failResume: boolean;
    blockedReason?: "user_input" | "runtime_failure" | "budget";
    lastError?: string;
    budgetDenied?: boolean;
    budgetPartial?: boolean;
  },
) {
  let currentTask = { ...blockedTask, blockedReason, lastError };
  let resumeAttempts = 0;
  let budgetAttempts = 0;
  const budgetRequests: Array<{ requestId: string; rootTaskId: number }> = [];
  const budgetReceipts = new Map<string, unknown>();
  const receipts = new Map<string, unknown>();
  let loseAck = false;
  let questionId = QUESTION_ID;
  let questionText = blockedTask.lastError;
  const requests: Array<{
    requestId: string;
    questionId: string;
    answer: string;
  }> = [];
  const submittedAnswers: string[] = [];
  const unexpected = new Set<string>();
  const messageScopes: Array<{
    agentId: string | null;
    taskId: string | null;
  }> = [];
  const activityScopes: Array<{
    agentId: string | null;
    taskId: string | null;
  }> = [];
  let vmStatusReads = 0;
  let browserViewReads = 0;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/status") {
      return json(route, {
        enabled: false,
        authenticated: true,
        sessionExpiresAt: null,
      });
    }
    if (path === "/api/settings/locale" && method === "PUT") {
      return json(route, request.postDataJSON());
    }
    if (path === "/api/healthz") return json(route, { status: "ok" });
    if (path === "/api/readyz") {
      return json(route, {
        status: "ready",
        checks: { startup: true, database: true, shuttingDown: false },
      });
    }
    if (path === "/api/ops/control") {
      return json(route, {
        emergencyStopEnabled: false,
        reason: null,
        version: 1,
        updatedBy: "task-resume-smoke",
        updatedAt: NOW,
        blockedScopes: [
          "agent_chat",
          "task_scheduler",
          "agent_tools",
          "approved_actions",
        ],
      });
    }
    if (path === "/api/org/summary") {
      return json(route, {
        totalAgents: 1,
        activeAgents: 1,
        workingAgents: currentTask.status === "blocked" ? 0 : 1,
        tasksInProgress: currentTask.status === "blocked" ? 0 : 1,
        tasksAwaitingApproval: 0,
        tasksCompletedToday: 0,
        pendingApprovals: 0,
        tokensUsedToday: currentTask.tokensUsed,
        estimatedCostTodayUsd: 0.18,
        usageEventsToday: 1,
        costReportedEventsToday: 1,
      });
    }
    if (path === "/api/agents") return json(route, [owner]);
    if (path === "/api/model-catalog") {
      return json(route, {
        providers: [{ id: "openrouter", label: "OpenRouter", available: true }],
        models: [
          {
            id: "minimax/minimax-m3:free",
            label: "MiniMax M3 Free",
            tier: "economy",
            provider: "openrouter",
            description: "Task resume fixture",
            supportsTools: true,
            isDefault: true,
          },
        ],
      });
    }
    if (path === "/api/company-chat") {
      return json(route, {
        id: 1,
        key: "company",
        name: "Şirket Geneli",
        activeAgentCount: 1,
        createdAt: NOW,
      });
    }
    if (path === "/api/company-chat/messages") return json(route, []);
    if (path === "/api/tasks/501/members" && method === "GET") {
      return json(route, [
        {
          taskId: blockedTask.id,
          agentId: owner.id,
          membershipRole: "coordinator",
          addedAt: NOW,
          agent: owner,
        },
      ]);
    }
    if (path === "/api/tasks/501" && method === "GET") {
      return json(route, currentTask);
    }
    if (path === "/api/tasks/501/budget-resume" && method === "GET")
      return json(route, {
        taskId: 501,
        rootTaskId: 501,
        budgetPaused:
          currentTask.status === "blocked" &&
          currentTask.blockedReason === "budget",
      });
    if (path.startsWith("/api/tasks/501/budget-resume/") && method === "GET") {
      const receipt = budgetReceipts.get(path.split("/").at(-1)!);
      return receipt
        ? json(route, receipt)
        : json(route, { error: "No committed receipt" }, 404);
    }
    if (path === "/api/tasks/501/budget-resume" && method === "POST") {
      budgetAttempts++;
      const body = request.postDataJSON() as {
        requestId: string;
        rootTaskId: number;
      };
      budgetRequests.push(body);
      if (failResume) return json(route, { error: "Lost request" }, 503);
      const receipt = {
        requestId: body.requestId,
        taskId: 501,
        rootTaskId: body.rootTaskId,
        outcome: budgetDenied ? "rejected" : "accepted",
        reason: budgetDenied ? "allowance_exhausted" : null,
        queuedTaskIds: budgetDenied ? [] : budgetPartial ? [502] : [501],
        queuedCount: budgetDenied ? 0 : 1,
        stillPausedCount: budgetDenied || budgetPartial ? 1 : 0,
        recordedAt: NOW,
      };
      budgetReceipts.set(body.requestId, receipt);
      if (!budgetDenied && !budgetPartial)
        currentTask = {
          ...currentTask,
          status: "pending",
          blockedReason: null,
          lastError: null,
          nextAttemptAt: NOW,
        };
      return loseAck
        ? json(route, { error: "Lost acknowledgement" }, 503)
        : json(route, receipt);
    }
    if (path === "/api/tasks/501/question")
      return json(route, {
        taskId: 501,
        questionId: currentTask.status === "blocked" ? questionId : null,
        question: currentTask.status === "blocked" ? questionText : null,
        ownerAgentId: 7,
        answerable:
          currentTask.status === "blocked" &&
          currentTask.blockedReason === "user_input",
      });
    if (path.startsWith("/api/tasks/501/resume/") && method === "GET")
      return json(
        route,
        receipts.get(path.split("/").at(-1)!) ?? {
          error: "No committed receipt",
        },
        receipts.has(path.split("/").at(-1)!) ? 200 : 404,
      );
    if (path === "/api/tasks/501/subtasks") return json(route, []);
    if (path === "/api/tasks/501/activity") {
      return json(route, projectActivity);
    }
    if (path === "/api/agents/7/messages" && method === "GET") {
      messageScopes.push({
        agentId: path.split("/")[3] ?? null,
        taskId: url.searchParams.get("taskId"),
      });
      return json(route, projectMessages);
    }
    if (path === "/api/activity" && method === "GET") {
      activityScopes.push({
        agentId: url.searchParams.get("agentId"),
        taskId: url.searchParams.get("taskId"),
      });
      return json(route, projectActivity);
    }
    if (path === "/api/agents/7/vm/status" && method === "GET") {
      vmStatusReads += 1;
      return json(route, vmStatus);
    }
    if (path === "/api/agents/7/browser/view" && method === "GET") {
      browserViewReads += 1;
      return json(route, browserView);
    }
    if (path === "/api/tasks/501/resume" && method === "POST") {
      resumeAttempts += 1;
      const body = request.postDataJSON() as {
        answer: string;
        requestId: string;
        questionId: string;
      };
      requests.push(body);
      if (typeof body.answer === "string") submittedAnswers.push(body.answer);
      if (failResume) {
        return json(route, { error: "Fixture connection failure" }, 503);
      }
      currentTask = {
        ...currentTask,
        status: "pending",
        nextAttemptAt: NOW,
        lastError: null,
        blockedReason: null,
        updatedAt: NOW,
      };
      const receipt = {
        taskId: 501,
        requestId: body.requestId,
        questionId: body.questionId,
        outcome: "accepted",
        reason: null,
        recordedAt: NOW,
      };
      receipts.set(body.requestId, receipt);
      return loseAck
        ? json(route, { error: "Lost acknowledgement" }, 503)
        : json(route, receipt);
    }

    unexpected.add(`${method} ${path}`);
    return json(route, { error: "Unexpected task-resume API request" }, 501);
  });

  return {
    unexpected,
    budgetAttempts: () => budgetAttempts,
    allowBudget: () => {
      budgetDenied = false;
      budgetPartial = false;
    },
    budgetRequests: () => [...budgetRequests],
    requests: () => requests,
    loseAcknowledgement: () => {
      loseAck = true;
    },
    changeQuestion: () => {
      questionId = "22222222-2222-4222-8222-222222222222";
      questionText = "Which date should we choose?";
    },
    attempts: () => resumeAttempts,
    answers: () => [...submittedAnswers],
    task: () => ({ ...currentTask }),
    pauseBudgetAgain: () => {
      currentTask = {
        ...currentTask,
        status: "blocked",
        blockedReason: "budget",
        lastError: "Later cycle allowance reached",
      };
    },
    messageScopes: () => [...messageScopes],
    activityScopes: () => [...activityScopes],
    vmStatusReads: () => vmStatusReads,
    browserViewReads: () => browserViewReads,
  };
}

async function expectProjectStudioScope(
  page: Page,
  harness: Awaited<ReturnType<typeof installResumeMocks>>,
) {
  await expect(
    page.getByRole("heading", {
      name: blockedTask.title,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Kayıt özeti", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", {
      name: "Proje konuşması",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Çalışma alanı", exact: true }),
  ).toHaveAttribute("aria-selected", "true");

  await expect.poll(() => harness.messageScopes().length).toBeGreaterThan(0);
  expect(harness.messageScopes()).toEqual(
    expect.arrayContaining([{ agentId: String(owner.id), taskId: "501" }]),
  );
  await expect.poll(() => harness.activityScopes().length).toBeGreaterThan(0);
  expect(harness.activityScopes()).toEqual(
    expect.arrayContaining([{ agentId: String(owner.id), taskId: "501" }]),
  );
  await expect.poll(harness.vmStatusReads).toBeGreaterThan(0);
  await expect.poll(harness.browserViewReads).toBeGreaterThan(0);
}

test.describe("blocked task operator handoff", () => {
  test("lost acknowledgement survives reload and is recovered with GET without another answer", async ({
    page,
  }) => {
    const harness = await installResumeMocks(page, { failResume: false });
    harness.loseAcknowledgement();
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/tasks/501");
    const text = page.getByRole("textbox", { name: "Ajana yanıtın" });
    await text.fill("Choose the documented release channel.");
    await page
      .getByRole("button", { name: "Yanıtı gönder ve devam ettir" })
      .click();
    await expect(
      page.getByRole("button", { name: "Gönderimi kontrol et" }),
    ).toBeVisible();
    await expect.poll(harness.attempts).toBe(1);
    await page.reload();
    await expect(text).toHaveValue("Choose the documented release channel.");
    await expect(text).toHaveAttribute("readonly", "");
    await page.getByRole("button", { name: "Gönderimi kontrol et" }).click();
    await expect(
      page
        .getByText("Yanıt kaydedildi. Görev devam etmek üzere sıraya alındı.")
        .first(),
    ).toBeVisible();
    expect(harness.attempts()).toBe(1);
    expect(harness.requests()[0].questionId).toBe(QUESTION_ID);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("acos.task-answer.v1:501"),
      ),
    ).toBeNull();
    expect([...harness.unexpected]).toEqual([]);
  });

  test("a missing receipt enables an explicit retry with the identical request and answer", async ({
    page,
  }) => {
    const harness = await installResumeMocks(page, { failResume: true });
    await page.goto("/tasks/501");
    await page
      .getByRole("textbox", { name: "Ajana yanıtın" })
      .fill("Same intent only.");
    await page
      .getByRole("button", { name: "Yanıtı gönder ve devam ettir" })
      .click();
    await page.getByRole("button", { name: "Gönderimi kontrol et" }).click();
    await page
      .getByRole("button", { name: "Aynı yanıtı yeniden dene" })
      .click();
    await expect.poll(harness.attempts).toBe(2);
    expect(harness.requests()[1]).toEqual(harness.requests()[0]);
  });

  test("changed question keeps the draft and requires reviewing the new question", async ({
    page,
  }) => {
    const harness = await installResumeMocks(page, { failResume: true });
    await page.goto("/tasks/501");
    const field = page.getByRole("textbox", { name: "Ajana yanıtın" });
    await field.fill("Draft for review.");
    harness.changeQuestion();
    await page.reload();
    await expect(field).toHaveValue("Draft for review.");
    await expect(
      page.getByRole("button", { name: "Yanıtı gönder ve devam ettir" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Güncel soruyu aç" }).click();
    await expect(
      page.getByText("Which date should we choose?", { exact: true }),
    ).toBeVisible();
    await expect(field).toHaveValue("Draft for review.");
    await page
      .getByRole("button", { name: "Yanıtı gönder ve devam ettir" })
      .click();
    await expect.poll(harness.attempts).toBe(1);
    expect(harness.requests()[0].questionId).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
  });

  test("storage failure keeps the draft on screen and sends nothing", async ({
    page,
  }) => {
    const harness = await installResumeMocks(page, { failResume: false });
    await page.goto("/tasks/501");
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("acos.task-answer")) throw new Error("denied");
        return original.call(this, key, value);
      };
    });
    const field = page.getByRole("textbox", { name: "Ajana yanıtın" });
    await field.fill("Keep this answer.");
    await page
      .getByRole("button", { name: "Yanıtı gönder ve devam ettir" })
      .click();
    await expect(page.getByRole("alert")).toContainText("Kurtarma bilgileri");
    await expect(field).toHaveValue("Keep this answer.");
    expect(harness.attempts()).toBe(0);
  });

  for (const [locale, label, send, required] of [
    ["tr", "Ajana yanıtın", "Yanıtı gönder ve devam ettir", "Bir yanıt yaz."],
    ["en", "Your answer", "Send answer and continue", "Enter an answer."],
    [
      "de",
      "Deine Antwort",
      "Antwort senden und fortsetzen",
      "Gib eine Antwort ein.",
    ],
    ["ru", "Ваш ответ", "Отправить ответ и продолжить", "Введите ответ."],
    ["zh-CN", "你的回答", "发送回答并继续", "请输入回答。"],
    ["zh-TW", "你的回答", "送出回答並繼續", "請輸入回答。"],
    ["ar", "إجابتك", "إرسال الإجابة والمتابعة", "أدخل إجابة."],
  ])
    test(`${locale} question and validated draft fit a phone and survive reload`, async ({
      page,
    }, info) => {
      await page.addInitScript(
        (l) => localStorage.setItem("acos.locale.v1", l),
        locale,
      );
      await page.setViewportSize({
        width: locale === "ar" ? 320 : 390,
        height: 844,
      });
      await page.emulateMedia({
        colorScheme: locale === "ar" ? "light" : "dark",
      });
      const harness = await installResumeMocks(page, { failResume: true });
      await page.goto("/tasks/501");
      const field = page.getByRole("textbox", { name: label });
      await field.fill(" ");
      await field.blur();
      await expect(page.getByText(required, { exact: true })).toBeVisible();
      await field.fill("Release plan 草稿 مسودة");
      await expect(page.getByText(required, { exact: true })).toHaveCount(0);
      await page.reload();
      await expect(field).toHaveValue("Release plan 草稿 مسودة");
      await expect(
        page.getByRole("button", { name: send, exact: true }),
      ).toBeEnabled();
      await field.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await page
          .getByRole("button", { name: send, exact: true })
          .evaluate((el) => el.getBoundingClientRect().height),
      ).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: info.outputPath(`answer-${locale}.png`) });
      expect(harness.attempts()).toBe(0);
    });

  test("failed resume keeps the operator answer in place", async ({ page }) => {
    const harness = await installResumeMocks(page, { failResume: true });
    const answer =
      "GitHub Releases ile başlat; README duyurusunu aynı sürüme bağla.";

    await page.goto("/tasks/501");
    await expectProjectStudioScope(page, harness);
    await expect(
      page.getByRole("heading", { name: "Nova senden yanıt bekliyor" }),
    ).toBeVisible();

    const textarea = page.getByRole("textbox", { name: "Ajana yanıtın" });
    await expect(textarea).toHaveAttribute("maxlength", "1200");
    await textarea.fill(answer);
    await page
      .getByRole("button", { name: "Yanıtı gönder ve devam ettir" })
      .click();

    await expect(page.getByRole("alert")).toContainText(
      "Metnin burada duruyor",
    );
    await expect(textarea).toHaveValue(answer);
    await expect(textarea).toBeFocused();
    await expect.poll(harness.attempts).toBe(1);
    expect(harness.answers()).toEqual([answer]);
    expect(harness.task().status).toBe("blocked");
    expect([...harness.unexpected]).toEqual([]);
  });

  test("successful resume moves the task back to the queue", async ({
    page,
  }) => {
    const harness = await installResumeMocks(page, { failResume: false });
    const answer =
      "GitHub Releases ile ilerle ve sürüm notlarını yayın kapısına hazırla.";

    await page.goto("/tasks/501");
    await expectProjectStudioScope(page, harness);
    await page.getByRole("textbox", { name: "Ajana yanıtın" }).fill(answer);
    await page
      .getByRole("button", { name: "Yanıtı gönder ve devam ettir" })
      .click();

    await expect(
      page.getByRole("heading", { name: "Nova senden yanıt bekliyor" }),
    ).toBeHidden();
    await expect(
      page
        .getByRole("region", { name: "Kayıt özeti", exact: true })
        .getByText("Kuyrukta", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .getByText("Yanıt kaydedildi. Görev devam etmek üzere sıraya alındı.", {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Açık kaynak lansman planını tamamla",
      }),
    ).toBeFocused();
    await expect.poll(harness.attempts).toBe(1);
    expect(harness.answers()).toEqual([answer]);
    expect(harness.task().status).toBe("pending");
    expect([...harness.unexpected]).toEqual([]);
  });

  test("generic runtime blocks do not expose the operator answer form", async ({
    page,
  }) => {
    const harness = await installResumeMocks(page, {
      failResume: false,
      blockedReason: "runtime_failure",
    });

    await page.goto("/tasks/501");
    await expectProjectStudioScope(page, harness);
    await expect(
      page.getByRole("heading", { name: "Nova senden yanıt bekliyor" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("textbox", { name: "Ajana yanıtın" }),
    ).toHaveCount(0);
    await expect.poll(harness.attempts).toBe(0);
    expect([...harness.unexpected]).toEqual([]);
  });
});

for (const locale of WORKSPACE_LOCALES) {
  test(`${locale} shared budget reason fits a phone and does not offer an answer form`, async ({
    page,
  }, info) => {
    await page.addInitScript(
      (value) => localStorage.setItem("acos.locale.v1", value),
      locale,
    );
    await page.setViewportSize({
      width: locale === "ar" ? 320 : 390,
      height: 844,
    });
    await page.emulateMedia({
      colorScheme: locale === "ar" ? "light" : "dark",
    });
    const reason = toolMessage(locale, "schedulerFamilyDailyCostBudget", {
      rootTaskId: 501,
      used: "8.10",
      limit: 8,
    });
    const harness = await installResumeMocks(page, {
      failResume: false,
      blockedReason: "budget",
      lastError: reason,
    });
    await page.goto("/tasks/501");
    await expect(page.getByText(reason, { exact: true })).toBeVisible();
    await expect(page.getByText(reason, { exact: true })).toBeInViewport({
      ratio: 1,
    });
    const copy = await loadProjectStudioCopy(locale);
    await expect(
      page.getByRole("textbox", { name: copy.answerLabel, exact: true }),
    ).toHaveCount(0);
    expect(harness.task().status).toBe("blocked");
    expect(harness.attempts()).toBe(0);
    expect([...harness.unexpected]).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`family-budget-${locale}.png`),
    });
    const action = page.getByRole("button", {
      name: copy.budgetCheck,
      exact: true,
    });
    await expect(action).toBeVisible();
    await expect(
      page.getByText(copy.budgetHelp, { exact: true }),
    ).toBeVisible();
    await action.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText(copy.budgetAccepted.replace("{count}", "1"), {
        exact: true,
      }),
    ).toBeVisible();
    expect(harness.budgetAttempts()).toBe(1);
    expect(harness.task().tokensUsed).toBe(blockedTask.tokensUsed);
  });
}

test("budget check queues work without changing displayed usage", async ({
  page,
}) => {
  const harness = await installResumeMocks(page, {
    failResume: false,
    blockedReason: "budget",
  });
  await page.goto("/tasks/501");
  await page
    .getByRole("button", {
      name: "Kullanım sınırını kontrol et ve devam ettir",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("1 iş devam etmek üzere sıraya alındı.", { exact: true }),
  ).toBeVisible();
  expect(harness.task().tokensUsed).toBe(blockedTask.tokensUsed);
  expect(harness.budgetAttempts()).toBe(1);
  expect(harness.attempts()).toBe(0);
});

test("partial budget acceptance keeps a fresh explicit check available without reload", async ({
  page,
}) => {
  const harness = await installResumeMocks(page, {
    failResume: false,
    blockedReason: "budget",
    budgetPartial: true,
  });
  await page.goto("/tasks/501");
  const action = page.getByRole("button", {
    name: "Kullanım sınırını kontrol et ve devam ettir",
    exact: true,
  });
  await action.click();
  await expect(
    page.getByText("1 iş devam etmek üzere sıraya alındı.", { exact: true }),
  ).toBeVisible();
  expect(harness.task().status).toBe("blocked");
  harness.allowBudget();
  await expect(action).toBeVisible();
  await action.click();
  await expect.poll(harness.budgetAttempts).toBe(2);
  expect(harness.budgetRequests()[0].requestId).not.toBe(
    harness.budgetRequests()[1].requestId,
  );
  await expect.poll(() => harness.task().status).toBe("pending");
});

test("a later budget pause on the same page permits a fresh explicit check", async ({
  page,
}) => {
  const harness = await installResumeMocks(page, {
    failResume: false,
    blockedReason: "budget",
  });
  await page.goto("/tasks/501");
  const action = page.getByRole("button", {
    name: "Kullanım sınırını kontrol et ve devam ettir",
    exact: true,
  });
  await action.click();
  await expect.poll(() => harness.task().status).toBe("pending");
  await expect(action).toBeHidden();
  harness.pauseBudgetAgain();
  await expect(
    page.getByText("Later cycle allowance reached", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(action).toBeVisible();
  await action.click();
  await expect.poll(harness.budgetAttempts).toBe(2);
  expect(harness.budgetRequests()[0].requestId).not.toBe(
    harness.budgetRequests()[1].requestId,
  );
});

test("budget lost acknowledgement survives reload and only inspects its receipt", async ({
  page,
}) => {
  const harness = await installResumeMocks(page, {
    failResume: false,
    blockedReason: "budget",
  });
  harness.loseAcknowledgement();
  await page.goto("/tasks/501");
  await page
    .getByRole("button", {
      name: "Kullanım sınırını kontrol et ve devam ettir",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "İşlem kaydını kontrol et", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "İşlem kaydını kontrol et", exact: true })
    .click();
  await expect(
    page.getByText("1 iş devam etmek üzere sıraya alındı.", { exact: true }),
  ).toBeVisible();
  expect(harness.budgetAttempts()).toBe(1);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem("acos.task-budget-resume.v1:501"),
    ),
  ).toBeNull();
});

test("budget missing receipt offers explicit same-identity retry", async ({
  page,
}) => {
  const harness = await installResumeMocks(page, {
    failResume: true,
    blockedReason: "budget",
  });
  await page.goto("/tasks/501");
  await page
    .getByRole("button", {
      name: "Kullanım sınırını kontrol et ve devam ettir",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "İşlem kaydını kontrol et", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Aynı isteği yeniden gönder", exact: true })
    .click();
  await expect.poll(harness.budgetAttempts).toBe(2);
  expect(harness.budgetRequests()[0]).toEqual(harness.budgetRequests()[1]);
});

test("budget storage failure sends nothing", async ({ page }) => {
  const harness = await installResumeMocks(page, {
    failResume: false,
    blockedReason: "budget",
  });
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("acos.task-budget-resume.v1:"))
        throw new DOMException("Fixture denied", "QuotaExceededError");
      return original.call(this, key, value);
    };
  });
  await page.goto("/tasks/501");
  await page
    .getByRole("button", {
      name: "Kullanım sınırını kontrol et ve devam ettir",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Hiçbir istek gönderilmedi" }),
  ).toBeVisible();
  expect(harness.budgetAttempts()).toBe(0);
});

test("budget denial retains usage and a later explicit check gets a new identity", async ({
  page,
}) => {
  const harness = await installResumeMocks(page, {
    failResume: false,
    blockedReason: "budget",
    budgetDenied: true,
  });
  const c = await loadProjectStudioCopy("tr");
  await page.goto("/tasks/501");
  const action = page.getByRole("button", { name: c.budgetCheck, exact: true });
  await action.click();
  await expect(
    page.getByText(c.budgetReasonExhausted, { exact: true }),
  ).toBeVisible();
  expect(harness.task().status).toBe("blocked");
  expect(harness.task().tokensUsed).toBe(blockedTask.tokensUsed);
  harness.allowBudget();
  await action.click();
  await expect(
    page.getByText(c.budgetAccepted.replace("{count}", "1"), { exact: true }),
  ).toBeVisible();
  expect(harness.budgetRequests()[0].requestId).not.toBe(
    harness.budgetRequests()[1].requestId,
  );
});

test("budget lazy load recovery retains an unconfirmed request", async ({
  page,
}) => {
  const harness = await installResumeMocks(page, {
    failResume: false,
    blockedReason: "budget",
  });
  harness.loseAcknowledgement();
  const c = await loadProjectStudioCopy("tr");
  await page.goto("/tasks/501");
  await page.getByRole("button", { name: c.budgetCheck, exact: true }).click();
  await expect(
    page.getByRole("button", { name: c.budgetInspect, exact: true }),
  ).toBeVisible();
  let fail = true;
  await page.route(/\/assets\/budget-task-resume-[^/]+\.js$/, async (route) => {
    if (fail) {
      fail = false;
      await route.abort("failed");
    } else await route.continue();
  });
  await page.reload();
  await expect(
    page.getByText(c.budgetLoadError, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: blockedTask.title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("alert")
    .filter({ hasText: c.budgetLoadError })
    .getByRole("button", { name: c.retry, exact: true })
    .click();
  await page
    .getByRole("button", { name: c.budgetInspect, exact: true })
    .click();
  await expect(
    page.getByText(c.budgetAccepted.replace("{count}", "1"), { exact: true }),
  ).toBeVisible();
  expect(harness.budgetAttempts()).toBe(1);
});

test("Arabic budget controls remain usable at 200 percent text on a 320px phone", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("acos.locale.v1", "ar"));
  await page.setViewportSize({ width: 320, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  const harness = await installResumeMocks(page, {
    failResume: false,
    blockedReason: "budget",
  });
  const c = await loadProjectStudioCopy("ar");
  const session = await page.context().newCDPSession(page);
  await session.send("Page.setFontSizes", {
    fontSizes: { standard: 32, fixed: 26 },
  });
  await page.goto("/tasks/501");
  await expect(
    page.getByRole("heading", { name: c.budgetHeading, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const action = page.getByRole("button", { name: c.budgetCheck, exact: true });
  await action.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(c.budgetAccepted.replace("{count}", "1"), { exact: true }),
  ).toBeVisible();
  expect(harness.budgetAttempts()).toBe(1);
});
