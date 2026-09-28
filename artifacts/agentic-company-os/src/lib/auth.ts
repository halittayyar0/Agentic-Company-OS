export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
  sessionExpiresAt: string | null;
}

export class ControlPlaneError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ControlPlaneError";
    this.status = status;
  }
}

async function readError(response: Response): Promise<string> {
  if (response.status === 401) return "Erişim anahtarı geçersiz.";
  if (response.status === 423) return "Bu işlem geçici olarak kilitli.";
  if (response.status === 429)
    return "Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.";
  if (response.status >= 500) return "Sunucu şu anda isteği tamamlayamıyor.";

  try {
    const body = (await response.json()) as Record<string, unknown>;
    const detail = body.detail ?? body.message ?? body.error;
    if (typeof detail === "string" && detail.trim()) return detail.trim();
  } catch {
    // The status-based message below is intentionally safe and deterministic.
  }
  return `İstek tamamlanamadı (HTTP ${response.status}).`;
}

export async function controlPlaneFetch<T>(
  input: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(input, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      window.dispatchEvent(new Event("agenticos:unauthorized"));
    }
    throw new ControlPlaneError(response.status, await readError(response));
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function assertAuthStatus(value: unknown): asserts value is AuthStatus {
  if (!value || typeof value !== "object") {
    throw new Error("Kimlik doğrulama durumu okunamadı.");
  }
  const data = value as Partial<AuthStatus>;
  if (
    typeof data.enabled !== "boolean" ||
    typeof data.authenticated !== "boolean" ||
    !(
      data.sessionExpiresAt === null ||
      typeof data.sessionExpiresAt === "string"
    )
  ) {
    throw new Error("Kimlik doğrulama durumu beklenen biçimde değil.");
  }
}

export async function getAuthStatus(): Promise<AuthStatus> {
  const status = await controlPlaneFetch<unknown>("/api/auth/status");
  assertAuthStatus(status);
  return status;
}

export async function login(token: string): Promise<AuthStatus> {
  await controlPlaneFetch<void>("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return getAuthStatus();
}

export async function logout(): Promise<void> {
  await controlPlaneFetch<void>("/api/auth/session", { method: "DELETE" });
}
