import { expect, test, type Page, type Route } from "@playwright/test";
import { getLocalizedAgentTemplates } from "../../artifacts/api-server/src/lib/agent-template-localization";
import { isWorkspaceLocale } from "../../artifacts/api-server/src/lib/workspace-locale";

const NOW = "2026-08-29T09:00:00.000Z";

const agent = {
  id: 1,
  configVersion: "a".repeat(64),
  isRootCeo: true,
  name: "Atlas",
  role: "CEO",
  department: "Yönetim",
  parentAgentId: null,
  depth: 0,
  status: "working",
  currentTaskId: null,
  currentAction: "Açık kaynak sürümünü hazırlıyor",
  lastActiveAt: NOW,
  systemPrompt: "Şirket hedeflerini güvenli ve ölçülebilir biçimde yürüt.",
  isCustomPrompt: false,
  templateKey: "ceo",
  modelMode: "auto",
  modelId: null,
  avatarColor: "#3b82f6",
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
  createdByAgentId: null,
  createdByUser: true,
  isActive: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const agents = [
  agent,
  {
    ...agent,
    id: 2,
    name: "Nova",
    role: "CTO",
    department: "Teknoloji",
    parentAgentId: 1,
    depth: 1,
    currentTaskId: 101,
    currentAction: "Sürüm kanıtlarını topluyor",
    templateKey: "cto",
    avatarColor: "#8b5cf6",
    createdByAgentId: 1,
    createdByUser: false,
  },
  {
    ...agent,
    id: 3,
    name: "Mira",
    role: "Growth Lead",
    department: "Büyüme",
    parentAgentId: 1,
    depth: 1,
    status: "idle",
    currentAction: null,
    templateKey: "growth",
    avatarColor: "#f97316",
    createdByAgentId: 1,
    createdByUser: false,
  },
  {
    ...agent,
    id: 4,
    name: "Rune",
    role: "Staff Engineer",
    department: "Teknoloji",
    parentAgentId: 2,
    depth: 2,
    currentTaskId: 101,
    currentAction: "Mobil kabul testlerini çalıştırıyor",
    templateKey: "engineer",
    avatarColor: "#14b8a6",
    createdByAgentId: 2,
    createdByUser: false,
  },
];

const task = {
  id: 101,
  title: "Açık kaynak sürüm kanıtlarını tamamla",
  brief: "Arayüz, erişilebilirlik ve yayın kapılarını doğrula.",
  status: "in_progress",
  priority: "high",
  ownerAgentId: 2,
  assignedByAgentId: 1,
  createdByUser: true,
  parentTaskId: null,
  progressPercent: 72,
  tokensUsed: 18420,
  estimatedCostUsd: "0.42",
  resultSummary: null,
  executionModelId: "minimax/minimax-m3:free",
  lastModelId: "minimax/minimax-m3:free",
  lastModelProvider: "openrouter",
  modelFallbackCount: 0,
  autonomyMode: "continuous",
  cadenceSeconds: 3600,
  lastHeartbeatAt: NOW,
  recoveryCount: 0,
  cycleCount: 4,
  lastCycleCompletedAt: NOW,
  lastSteppedAt: NOW,
  stepAttempts: 1,
  consecutiveFailures: 0,
  nextAttemptAt: "2026-08-29T10:00:00.000Z",
  lastError: null,
  dueAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  completedAt: null,
};

const activity = [
  {
    id: 3,
    agentId: 4,
    taskId: 101,
    type: "progress_update",
    summary: "Mobil kabul kapısı doğrulanıyor",
    detail: { progressPercent: 72 },
    severity: "info",
    createdAt: NOW,
  },
  {
    id: 2,
    agentId: 2,
    taskId: 101,
    type: "task_delegated",
    summary: "UI doğrulaması Rune'a devredildi",
    detail: { toAgentId: 4 },
    severity: "info",
    createdAt: NOW,
  },
];

const workforceBlueprints = [
  {
    key: "product-shipping-crew",
    version: 1,
    name: "Ürün Teslim Ekibi",
    tagline: "Problemi doğrula, ürünü çıkar, sonucu kanıtla.",
    description:
      "Keşiften teknik teslimata kadar ürün kararlarını kanıtla ilerleten ekip.",
    orchestration: "crew",
    recommendedFor: ["Yeni özellik", "MVP"],
    triggerLabels: ["ürün", "MVP"],
    members: [
      {
        key: "product-lead",
        name: "Ürün Orkestratörü",
        role: "Product Delivery Lead",
        department: "product",
        templateKey: "product_director",
        mission: "İş sonucunu ölçülebilir kabul kriterlerine çevir.",
        level: "lead",
        reportsToKey: null,
        capabilities: ["Teslim planı", "Sonuç incelemesi"],
      },
      {
        key: "delivery-engineer",
        name: "Teslim Mühendisi",
        role: "Product Delivery Engineer",
        department: "engineering",
        templateKey: "specialist",
        mission: "Onaylı kapsamı güvenli ve test edilebilir ürüne dönüştür.",
        level: "specialist",
        reportsToKey: "product-lead",
        capabilities: ["Uygulama", "Test otomasyonu"],
      },
    ],
    handoffs: [
      {
        fromKey: "product-lead",
        toKey: "delivery-engineer",
        mode: "ai",
        instruction:
          "Kapsamı ve kanıt beklentisini uygulama brief'i olarak aktar.",
      },
    ],
  },
];

const companyMessages = [
  {
    id: 1,
    channelId: 1,
    senderType: "founder",
    senderAgentId: null,
    senderName: "Kurucu",
    senderRole: null,
    senderAvatarColor: null,
    content: "Sürüm kapılarını kanıtlarıyla tamamlayın.",
    source: "operator",
    taskId: 101,
    replyToMessageId: null,
    modelId: null,
    createdAt: NOW,
  },
  {
    id: 2,
    channelId: 1,
    senderType: "agent",
    senderAgentId: 1,
    senderName: "Atlas",
    senderRole: "CEO",
    senderAvatarColor: "#3b82f6",
    content: "Nova sürümü, Rune mobil kabul testlerini yürütüyor.",
    source: "meeting",
    taskId: 101,
    replyToMessageId: 1,
    modelId: "minimax/minimax-m3:free",
    createdAt: NOW,
  },
];

const companyMembers = agents.map((member) => ({
  channelId: 1,
  agentId: member.id,
  name: member.name,
  role: member.role,
  department: member.department,
  status: member.status,
  avatarColor: member.avatarColor,
  isActive: member.isActive,
  joinedAt: NOW,
}));

const modelCatalog = {
  providers: [{ id: "openrouter", label: "OpenRouter", available: true }],
  models: [
    {
      id: "minimax/minimax-m3:free",
      label: "MiniMax M3 Free",
      tier: "economy",
      provider: "openrouter",
      description: "Release smoke fixture",
      supportsTools: true,
      isDefault: true,
    },
  ],
};

const opsControl = {
  emergencyStopEnabled: false,
  reason: null,
  version: 1,
  updatedBy: "release-smoke",
  updatedAt: NOW,
  blockedScopes: [
    "agent_chat",
    "task_scheduler",
    "agent_tools",
    "approved_actions",
  ],
};

const vmStatus = {
  agentId: 1,
  workspaceId: "agent-1",
  lifecycle: "ready",
  isolation: "filesystem_sandbox",
  persistent: true,
  processExecutionEnabled: true,
  exists: true,
  cwd: ".",
  totalBytes: 0,
  fileCount: 0,
  dirCount: 0,
};

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  });
}

async function installApiMocks(page: Page) {
  const unexpected = new Set<string>();
  const workforceInstalls: unknown[] = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (
      path === "/api/inference-accounting" &&
      request.method() === "GET" &&
      url.searchParams.get("scopeType") === "agent" &&
      url.searchParams.get("scopeId") === "1"
    ) {
      return json(route, {
        scopeType: "agent",
        scopeId: 1,
        rootTaskId: null,
        status: "clear",
        observedAt: Date.now(),
        unsettledCount: 0,
        hasMore: false,
        attempts: [],
      });
    }

    if (path === "/api/auth/status") {
      return json(route, {
        enabled: false,
        authenticated: true,
        sessionExpiresAt: null,
      });
    }
    if (path === "/api/settings/locale" && request.method() === "PUT") {
      return json(route, request.postDataJSON());
    }
    if (path === "/api/agent-templates" && request.method() === "GET") {
      const locale = url.searchParams.get("locale") ?? "tr";
      if (!isWorkspaceLocale(locale))
        return route.fulfill({
          status: 400,
          json: { error: "Invalid locale" },
        });
      return json(route, getLocalizedAgentTemplates(locale));
    }
    if (path === "/api/ops/control") return json(route, opsControl);
    if (path === "/api/healthz") return json(route, { status: "ok" });
    if (path === "/api/readyz") {
      return json(route, {
        status: "ready",
        checks: { startup: true, database: true, shuttingDown: false },
      });
    }
    if (path === "/api/org/summary") {
      return json(route, {
        totalAgents: 4,
        activeAgents: 4,
        workingAgents: 3,
        tasksInProgress: 1,
        tasksAwaitingApproval: 0,
        tasksCompletedToday: 0,
        pendingApprovals: 0,
        tokensUsedToday: 0,
        estimatedCostTodayUsd: 0,
        usageEventsToday: 0,
        costReportedEventsToday: 0,
      });
    }
    if (path === "/api/model-catalog") return json(route, modelCatalog);
    if (path === "/api/company-chat") {
      return json(route, {
        id: 1,
        key: "company",
        name: "Şirket Geneli",
        activeAgentCount: 4,
        createdAt: NOW,
      });
    }
    if (path === "/api/company-chat/members") {
      return json(route, companyMembers);
    }
    if (path === "/api/company-chat/messages") {
      return json(route, companyMessages);
    }
    if (path === "/api/workforce-blueprints" && request.method() === "GET") {
      return json(route, workforceBlueprints);
    }
    if (
      path === "/api/workforce-blueprints/product-shipping-crew/install" &&
      request.method() === "POST"
    ) {
      workforceInstalls.push(request.postDataJSON());
      const installedAgents = workforceBlueprints[0].members.map(
        (member, index) => ({
          ...agent,
          id: 10 + index,
          name: member.name,
          role: member.role,
          department: member.department,
          parentAgentId: index === 0 ? agent.id : 10,
          depth: index === 0 ? 1 : 2,
          status: "idle",
          currentAction: null,
          systemPrompt: "Hazır ekip çalışma sözleşmesi",
          isCustomPrompt: true,
          templateKey: member.templateKey,
          createdByAgentId: index === 0 ? agent.id : 10,
        }),
      );
      return json(
        route,
        {
          blueprintKey: workforceBlueprints[0].key,
          version: workforceBlueprints[0].version,
          agents: installedAgents,
          task: {
            ...task,
            id: 202,
            title:
              "Ürün Teslim Ekibi: Açık kaynak onboarding akışını teslim et.",
            brief: "Açık kaynak onboarding akışını teslim et.",
            ownerAgentId: 10,
            assignedByAgentId: agent.id,
            status: "pending",
            progressPercent: 0,
            autonomyMode: "continuous",
            cadenceSeconds: 3600,
          },
        },
        201,
      );
    }
    if (path === "/api/agents") return json(route, agents);
    if (path === "/api/agents/1") return json(route, agent);
    if (path === "/api/agents/1/messages") {
      return json(route, []);
    }
    if (path === "/api/agents/1/vm/status") return json(route, vmStatus);
    if (path === "/api/agents/1/vm/files-list") {
      return json(route, { path: ".", entries: [], total: 0 });
    }
    if (path === "/api/agents/1/browser/view") {
      return json(route, {
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
        note: "Release smoke fixture",
      });
    }
    if (
      path === "/api/tasks" ||
      path === "/api/activity" ||
      path === "/api/approvals"
    ) {
      return json(
        route,
        path === "/api/tasks"
          ? [task]
          : path === "/api/activity"
            ? activity
            : [],
      );
    }

    unexpected.add(`${request.method()} ${path}`);
    return json(route, { error: "Unexpected release-smoke API request" }, 501);
  });

  return { unexpected, workforceInstalls };
}

test.describe("Agentic Company OS release smoke", () => {
  test("root renders and the mobile company menu stays compact", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 658, height: 850 });
    const harness = await installApiMocks(page);

    await page.goto("/");
    await expect(
      page.getByRole("main", { name: "Ana Sayfa", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Bugün neyi birlikte başarmalıyız?",
        exact: true,
      }),
    ).toBeVisible();

    const sidebar = page.locator("#app-navigation");
    const navigation = sidebar.getByRole("navigation", { name: "Ana menü" });
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");

    const menuButton = page.getByRole("button", {
      name: "Menüyü aç",
    });
    await menuButton.focus();
    await page.keyboard.press("Enter");
    await expect(sidebar).not.toHaveAttribute("aria-hidden", "true");
    await expect(navigation.getByRole("link")).toHaveCount(9);
    for (const [name, href] of [
      ["Ana Sayfa", "/"],
      ["Projelerim", "/projects"],
      ["Operasyon Merkezi", "/operations"],
      ["Onaylar", "/approvals"],
      ["Şirket Odası", "/company-chat"],
      ["Beceriler ve araçlar", "/skills"],
      ["Ekipler", "/workforces"],
      ["Uzmanlar", "/agents"],
      ["Bağlantılar", "/settings"],
    ] as const) {
      await expect(
        navigation.getByRole("link", { name, exact: true }),
      ).toHaveAttribute("href", href);
    }
    const drawerBox = await sidebar.boundingBox();
    expect(drawerBox).not.toBeNull();
    expect(drawerBox!.y).toBeGreaterThanOrEqual(0);
    expect(drawerBox!.y + drawerBox!.height).toBeLessThanOrEqual(850);

    await page.keyboard.press("Escape");
    await expect(sidebar).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("button", { name: "Menüyü aç" })).toBeFocused();

    expect([...harness.unexpected]).toEqual([]);
  });

  test("light and dark preference persists across reloads", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    const harness = await installApiMocks(page);
    await page.goto("/");

    const root = page.locator("html");
    await expect(root).toHaveClass(/light/);
    await expect(root).toHaveAttribute("data-color-mode", "system");
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("acos.color-mode.v2")),
      )
      .toBe("system");

    await page.getByRole("button", { name: "Koyu temaya geç" }).click();
    await expect(root).toHaveClass(/dark/);
    await expect(root).toHaveAttribute("data-color-mode", "dark");
    await expect
      .poll(() =>
        page.evaluate(() => localStorage.getItem("acos.color-mode.v2")),
      )
      .toBe("dark");

    await page.reload();
    await expect(root).toHaveClass(/dark/);
    await page.getByRole("button", { name: "Açık temaya geç" }).click();
    await expect(root).toHaveClass(/light/);
    await page.reload();
    await expect(root).toHaveClass(/light/);

    expect([...harness.unexpected]).toEqual([]);
  });

  test("projects and conversations provide persistent work context", async ({
    page,
  }) => {
    const harness = await installApiMocks(page);

    await page.goto("/projects");
    await expect(page).toHaveURL(/\/projects$/);
    await expect(
      page.getByRole("heading", { name: "Projeler", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Açık kaynak sürüm kanıtlarını tamamla",
        exact: true,
      }),
    ).toBeVisible();

    await page.getByRole("link", { name: "Şirket Odası", exact: true }).click();
    await expect(page).toHaveURL(/\/company-chat$/);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Şirket odası",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Sürüm kapılarını kanıtlarıyla tamamlayın."),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Atlas.*sohbeti aç/i }),
    ).toHaveAttribute("href", "/agents/1?tab=chat&from=conversations");
    const memberRail = page.getByRole("complementary", {
      name: "Şirket odası üyeleri",
    });
    await expect(
      memberRail.getByRole("button", { name: /Atlas/ }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      page.getByText(
        "Etiket yoksa oda üyeleri mesajı değerlendirir; yalnız katkısı olanlar yanıt verir.",
      ),
    ).toBeVisible();
    await expect(page.getByText(/Söz hakkı/)).toHaveCount(0);

    const roomComposer = page.getByRole("textbox", {
      name: "Şirket odasına mesaj",
    });
    await roomComposer.fill("@");
    const mentionPicker = page.getByRole("listbox", {
      name: "Etiketlenecek oda üyeleri",
    });
    await expect(mentionPicker).toBeVisible();
    await mentionPicker.getByRole("option", { name: /Atlas/ }).click();
    await expect(roomComposer).toHaveValue("@Atlas ");

    expect([...harness.unexpected]).toEqual([]);
  });

  test("mobile context stays in frame and project modes follow radio keyboard rules", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const harness = await installApiMocks(page);

    for (const path of ["/tasks", "/company-chat"]) {
      await page.goto(path);
      const width = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(width.scroll).toBeLessThanOrEqual(width.client);
    }

    const mobileComposer = page.getByRole("textbox", {
      name: "Şirket odasına mesaj",
    });
    await mobileComposer.fill("@");
    await expect(
      page.getByRole("listbox", { name: "Etiketlenecek oda üyeleri" }),
    ).toBeVisible();
    const pickerWidth = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    expect(pickerWidth.scroll).toBeLessThanOrEqual(pickerWidth.client);

    await page.goto("/tasks/new");
    const finite = page.getByRole("radio", {
      name: "Teslim odaklı",
      exact: true,
    });
    const continuous = page.getByRole("radio", {
      name: "Sürekli",
      exact: true,
    });
    await finite.focus();
    await page.keyboard.press("ArrowRight");
    await expect(continuous).toHaveAttribute("aria-checked", "true");
    await expect(continuous).toBeFocused();

    const normal = page.getByRole("radio", { name: "Normal", exact: true });
    const high = page.getByRole("radio", { name: "Yüksek", exact: true });
    await normal.focus();
    await page.keyboard.press("ArrowDown");
    await expect(high).toHaveAttribute("aria-checked", "true");
    await expect(high).toBeFocused();

    await expect(
      page.getByLabel("4 aktif uzmandan oluşan proje ekibi"),
    ).toBeVisible();
    await expect(
      page.getByText(/Tek bir sorumlu seçmiyorsun\. 4 aktif uzman/),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: /Atlas/ })).toHaveCount(0);
    await expect(page.getByRole("radio", { name: /Nova/ })).toHaveCount(0);

    expect([...harness.unexpected]).toEqual([]);
  });

  test("agent detail keeps the narrow task room focused and exposes avatar controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 658, height: 850 });
    const harness = await installApiMocks(page);
    let browserViewRequests = 0;
    let vmStatusRequests = 0;
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/api/agents/1/browser/view") browserViewRequests += 1;
      if (path === "/api/agents/1/vm/status") vmStatusRequests += 1;
    });
    await page.goto("/agents/1");
    await expect(page).toHaveURL(/\/agents\/1$/);
    await expect(page.getByRole("heading", { name: "Atlas" })).toBeVisible();

    await expect(
      page.locator('[aria-label="Atlas bilgisayar çalışma alanı"]:visible'),
    ).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Sohbet" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.waitForTimeout(1_100);
    expect(browserViewRequests).toBe(0);
    expect(vmStatusRequests).toBe(0);

    await page.getByRole("tab", { name: "Bilgisayar", exact: true }).click();
    await expect(
      page.locator('[aria-label="Atlas bilgisayar çalışma alanı"]:visible'),
    ).toHaveCount(1);
    await expect.poll(() => browserViewRequests).toBeGreaterThan(0);
    await expect.poll(() => vmStatusRequests).toBeGreaterThan(0);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "hidden",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(150);
    const hiddenBrowserCount = browserViewRequests;
    await page.waitForTimeout(1_100);
    expect(browserViewRequests).toBe(hiddenBrowserCount);

    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expect
      .poll(() => browserViewRequests)
      .toBeGreaterThan(hiddenBrowserCount);

    const settingsTab = page.getByRole("tab", {
      name: "Ayarlar",
      exact: true,
    });
    await settingsTab.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByText("Kayıtlı yapılandırma", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Portre", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Görsel seç", { exact: true }),
    ).toHaveAttribute("type", "file");
    await expect(
      page.getByRole("button", { name: "Görsel seç" }),
    ).toBeVisible();

    expect([...harness.unexpected]).toEqual([]);
  });

  test("workforce studio installs a versioned team and preserves the kickoff contract", async ({
    page,
  }) => {
    const harness = await installApiMocks(page);
    const outcome = "Açık kaynak onboarding akışını teslim et.";

    await page.goto("/workforces");
    await expect(
      page.getByRole("heading", { name: "Ekip Stüdyosu" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Ürün Teslim Ekibi" }),
    ).toBeVisible();
    await expect(page.getByText("product-shipping-crew@1")).toBeVisible();

    await page.getByLabel(/İlk sonuç/).fill(outcome);
    await page.getByRole("button", { name: "Sürekli" }).click();
    await page.getByRole("button", { name: "Ekibi kur ve başlat" }).click();

    await expect(page.getByText("Kurulum makbuzu")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Canlı işi aç · #202/ }),
    ).toBeVisible();
    await expect.poll(() => harness.workforceInstalls.length).toBe(1);
    expect(harness.workforceInstalls).toEqual([
      {
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        locale: "tr",
        blueprintVersion: 1,
        managerAgentId: 1,
        outcome,
        autonomyMode: "continuous",
        cadenceSeconds: 3600,
      },
    ]);
    expect([...harness.unexpected]).toEqual([]);
  });
});
