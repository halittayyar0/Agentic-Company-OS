import type { InstallationPlan } from "./plan";

export async function applyInstallationPreferences(
  plan: InstallationPlan,
  context: { baseUrl: string; operatorToken: string; directory: string },
): Promise<void> {
  const url = new URL(context.baseUrl);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("Setup preferences require a loopback runtime");
  async function api(
    path: string,
    body?: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await fetch(new URL(`/api/${path}`, url), {
      method: body === undefined ? "GET" : "PUT",
      headers: {
        authorization: `Bearer ${context.operatorToken}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new Error(
        `Installation preference request failed (${response.status})`,
      );
    const bytes = await response.text();
    if (bytes.length > 64000)
      throw new Error("Installation preference response too large");
    const value: unknown = JSON.parse(bytes);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("Invalid installation preference response");
    return value as Record<string, unknown>;
  }
  const expected = plan.settings;
  const samePermissions = (value: unknown) =>
    expected.customPermissions
      ? value !== null &&
        typeof value === "object" &&
        Object.keys(value).length === 5 &&
        Object.entries(expected.customPermissions).every(
          ([key, enabled]) =>
            (value as Record<string, unknown>)[key] === enabled,
        )
      : value === null || value === undefined;
  const locale = await api("settings/locale");
  if (locale.locale !== expected.locale)
    await api("settings/locale", { locale: expected.locale });
  const policy = await api("settings/execution-policy");
  const sameCustom = samePermissions(policy.custom);
  if (policy.mode !== expected.accessMode || !sameCustom)
    await api("settings/execution-policy", {
      mode: expected.accessMode,
      expectedRevision: policy.revision,
      ...(expected.accessMode === "custom"
        ? { custom: expected.customPermissions }
        : {}),
    });
  const packs = await api("skills/packs");
  const samePacks = (value: unknown) =>
    Array.isArray(value) &&
    JSON.stringify([...value].sort()) ===
      JSON.stringify([...expected.toolPacks].sort());
  if (!samePacks(packs.enabledPacks))
    await api("skills/packs", {
      enabledPacks: expected.toolPacks,
      expectedRevision: packs.revision,
    });
  const [savedLocale, savedPolicy, savedPacks] = await Promise.all([
    api("settings/locale"),
    api("settings/execution-policy"),
    api("skills/packs"),
  ]);
  if (
    savedLocale.locale !== expected.locale ||
    savedPolicy.mode !== expected.accessMode ||
    !samePermissions(savedPolicy.custom) ||
    !samePacks(savedPacks.enabledPacks)
  )
    throw new Error("Installation preferences did not persist");
}
