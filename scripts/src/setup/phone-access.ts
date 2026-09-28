import { runSetupProbe } from "./preflight";
export interface PhoneConnection {
  url: string;
  target: string;
  port: number;
}
export async function verifyPhoneAccess(
  connection: PhoneConnection,
  operatorToken: string,
  request: typeof fetch = fetch,
) {
  const url = new URL(connection.url);
  if (
    url.protocol !== "https:" ||
    !url.hostname.endsWith(".ts.net") ||
    url.port !== "8443" ||
    url.username ||
    url.password
  )
    throw new Error("PHONE_URL_INVALID");
  for (const [pathname, authenticated, expected] of [
    ["/", false, 200],
    ["/api/skills?locale=en", false, 401],
    ["/api/skills?locale=en", true, 200],
  ] as const) {
    const response = await request(new URL(pathname, url), {
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: authenticated
        ? { authorization: `Bearer ${operatorToken}` }
        : {},
    });
    await response.body?.cancel();
    if (response.status !== expected)
      throw new Error("PHONE_CONNECTION_NOT_READY");
  }
}
export async function inspectPhoneAccess(
  port: number,
  run = runSetupProbe,
): Promise<PhoneConnection> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("PHONE_PORT_INVALID");
  let status: { BackendState?: unknown; Self?: { DNSName?: unknown } };
  try {
    status = JSON.parse(await run("tailscale", ["status", "--json"]));
  } catch {
    throw new Error("PHONE_TAILSCALE_REQUIRED");
  }
  if (status.BackendState !== "Running")
    throw new Error("PHONE_LOGIN_REQUIRED");
  const host = String(status.Self?.DNSName ?? "").replace(/\.$/u, "");
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z0-9-]+\.ts\.net$/u.test(host))
    throw new Error("PHONE_DNS_REQUIRED");
  const config = JSON.parse(
    await run("tailscale", ["serve", "status", "--json"]),
  ) as {
    TCP?: Record<string, unknown>;
    Web?: Record<string, { Handlers?: Record<string, { Proxy?: unknown }> }>;
    AllowFunnel?: Record<string, unknown>;
  };
  const target = `http://127.0.0.1:${port}`,
    address = `${host}:8443`,
    web = config.Web?.[address];
  if (config.AllowFunnel?.[address])
    throw new Error("PHONE_PUBLIC_LISTENER_CONFLICT");
  if (
    config.TCP?.["8443"] &&
    (!web?.Handlers ||
      Object.keys(web.Handlers).length !== 1 ||
      web.Handlers["/"]?.Proxy !== target)
  )
    throw new Error("PHONE_PORT_IN_USE");
  return { url: `https://${address}`, target, port };
}
export async function configurePhoneAccess(
  connection: PhoneConnection,
  run = runSetupProbe,
): Promise<void> {
  const current = await inspectPhoneAccess(connection.port, run);
  if (current.url !== connection.url || current.target !== connection.target)
    throw new Error("PHONE_CONFIGURATION_CHANGED");
  await run("tailscale", ["serve", "--bg", "--https=8443", connection.target]);
}
