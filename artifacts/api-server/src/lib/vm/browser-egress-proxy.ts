import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import https from "node:https";
import net, { type AddressInfo, type Socket } from "node:net";
import type { Duplex } from "node:stream";
import tls from "node:tls";
import { resolveSafeBrowserTarget } from "./browser-network-policy";

const CONNECT_TIMEOUT_MS = 20_000;
const TUNNEL_IDLE_TIMEOUT_MS = 2 * 60_000;
const PROXY_CLOSE_TIMEOUT_MS = 2_000;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

interface BrowserEgressProxy {
  server: http.Server;
  url: string;
  sockets: Set<Duplex>;
}

let activeProxy: Promise<BrowserEgressProxy> | null = null;
let closingProxy: Promise<void> | null = null;

/**
 * Raw CONNECT/upgrade sockets stop being managed by Node's HTTP parser. A
 * browser process disappearing while a tunnel write is queued is therefore a
 * normal per-connection failure (not a process-level exception). Keep an
 * error listener on every client and upstream tunnel socket for its complete
 * lifetime and remove it from the shutdown registry as soon as it dies.
 */
export function guardBrowserProxySocket(
  socket: Duplex,
  sockets: Set<Duplex>,
): void {
  sockets.add(socket);
  const forget = () => sockets.delete(socket);
  socket.once("close", forget);
  socket.on("error", () => {
    forget();
    if (!socket.destroyed) socket.destroy();
  });
}

function safeSocketWrite(socket: Duplex, data: string | Buffer): boolean {
  if (socket.destroyed || !socket.writable) return false;
  try {
    socket.write(data, (error?: Error | null) => {
      if (error && !socket.destroyed) socket.destroy();
    });
    return true;
  } catch {
    socket.destroy();
    return false;
  }
}

function removeHopByHopHeaders(
  headers: IncomingHttpHeaders,
  host?: string,
): OutgoingHttpHeaders {
  const blocked = new Set(HOP_BY_HOP_HEADERS);
  for (const token of (headers.connection ?? "").split(",")) {
    const normalized = token.trim().toLowerCase();
    if (normalized) blocked.add(normalized);
  }
  const forwarded: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !blocked.has(name.toLowerCase())) {
      forwarded[name] = value;
    }
  }
  if (host !== undefined) forwarded.host = host;
  return forwarded;
}

function proxyError(res: ServerResponse, status: 403 | 400 | 502): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const label =
    status === 403
      ? "Browser egress policy blocked the target"
      : status === 400
        ? "Invalid proxy request"
        : "Browser egress connection failed";
  res.writeHead(status, {
    "Cache-Control": "no-store",
    Connection: "close",
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": Buffer.byteLength(label),
  });
  res.end(label);
}

function socketError(socket: Duplex, status: 400 | 403 | 502): void {
  if (!socket.destroyed && socket.writable) {
    const label =
      status === 403
        ? "Forbidden"
        : status === 400
          ? "Bad Request"
          : "Bad Gateway";
    try {
      socket.end(
        `HTTP/1.1 ${status} ${label}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
      );
    } catch {
      socket.destroy();
    }
  }
}

function parsePort(raw: string, fallback: number): number {
  if (raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error("Invalid target port");
  }
  return parsed;
}

async function forwardHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  let target: URL;
  try {
    target = new URL(req.url ?? "");
    if (
      !["http:", "https:"].includes(target.protocol) ||
      target.username ||
      target.password
    ) {
      throw new Error("Unsupported proxy target");
    }
  } catch {
    proxyError(res, 400);
    return;
  }

  try {
    const resolved = await resolveSafeBrowserTarget(target.hostname);
    const secure = target.protocol === "https:";
    const port = parsePort(target.port, secure ? 443 : 80);
    const headers = removeHopByHopHeaders(req.headers, target.host);
    const requestOptions: https.RequestOptions = {
      host: resolved.address,
      family: resolved.family,
      port,
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
      ...(secure
        ? { servername: resolved.hostname, rejectUnauthorized: true }
        : {}),
    };
    const upstream = (secure ? https : http).request(
      requestOptions,
      (upstreamResponse) => {
        upstreamResponse.once("error", () => res.destroy());
        res.writeHead(
          upstreamResponse.statusCode ?? 502,
          removeHopByHopHeaders(upstreamResponse.headers),
        );
        upstreamResponse.pipe(res);
      },
    );
    upstream.setTimeout(CONNECT_TIMEOUT_MS, () =>
      upstream.destroy(new Error("Proxy upstream timeout")),
    );
    upstream.once("error", () => proxyError(res, 502));
    req.once("aborted", () => upstream.destroy());
    req.once("error", () => upstream.destroy());
    res.once("error", () => upstream.destroy());
    res.once("close", () => upstream.destroy());
    req.pipe(upstream);
  } catch {
    proxyError(res, 403);
  }
}

function connectAuthority(raw: string | undefined): {
  hostname: string;
  port: number;
} {
  if (!raw || raw.length > 512 || /[\s/?#]/.test(raw)) {
    throw new Error("Invalid CONNECT authority");
  }
  const parsed = new URL(`http://${raw}`);
  if (parsed.username || parsed.password || parsed.pathname !== "/") {
    throw new Error("Invalid CONNECT authority");
  }
  return { hostname: parsed.hostname, port: parsePort(parsed.port, 443) };
}

async function forwardConnect(
  req: IncomingMessage,
  client: Duplex,
  head: Buffer,
  sockets: Set<Duplex>,
): Promise<void> {
  let authority: { hostname: string; port: number };
  try {
    authority = connectAuthority(req.url);
  } catch {
    socketError(client, 400);
    return;
  }

  try {
    const resolved = await resolveSafeBrowserTarget(authority.hostname);
    if (client.destroyed) return;
    const upstream = net.connect({
      host: resolved.address,
      family: resolved.family,
      port: authority.port,
    });
    guardBrowserProxySocket(upstream, sockets);
    upstream.setTimeout(TUNNEL_IDLE_TIMEOUT_MS, () => upstream.destroy());
    upstream.once("connect", () => {
      if (
        client.destroyed ||
        upstream.destroyed ||
        !safeSocketWrite(
          client,
          "HTTP/1.1 200 Connection Established\r\nProxy-Agent: Agentic-Company-OS\r\n\r\n",
        )
      ) {
        upstream.destroy();
        return;
      }
      if (head.length > 0 && !safeSocketWrite(upstream, head)) {
        client.destroy();
        return;
      }
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once("error", () => socketError(client, 502));
  } catch {
    socketError(client, 403);
  }
}

function upgradeHeaders(req: IncomingMessage, target: URL): string {
  const headers: string[] = [];
  for (const [name, value] of Object.entries(req.headers)) {
    const normalized = name.toLowerCase();
    if (
      value === undefined ||
      normalized === "proxy-authorization" ||
      normalized === "proxy-connection" ||
      normalized === "host"
    ) {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      headers.push(`${name}: ${item}`);
    }
  }
  headers.push(`Host: ${target.host}`);
  return headers.join("\r\n");
}

async function forwardUpgrade(
  req: IncomingMessage,
  client: Duplex,
  head: Buffer,
  sockets: Set<Duplex>,
): Promise<void> {
  let target: URL;
  try {
    target = new URL(req.url ?? "");
    if (
      !["ws:", "wss:"].includes(target.protocol) ||
      target.username ||
      target.password
    ) {
      throw new Error("Invalid WebSocket target");
    }
  } catch {
    socketError(client, 400);
    return;
  }

  try {
    const resolved = await resolveSafeBrowserTarget(target.hostname);
    if (client.destroyed) return;
    const secure = target.protocol === "wss:";
    const port = parsePort(target.port, secure ? 443 : 80);
    const upstream: Socket = secure
      ? tls.connect({
          host: resolved.address,
          port,
          servername: resolved.hostname,
          rejectUnauthorized: true,
        })
      : net.connect({
          host: resolved.address,
          family: resolved.family,
          port,
        });
    guardBrowserProxySocket(upstream, sockets);
    upstream.setTimeout(TUNNEL_IDLE_TIMEOUT_MS, () => upstream.destroy());
    upstream.once(secure ? "secureConnect" : "connect", () => {
      if (client.destroyed || upstream.destroyed) {
        upstream.destroy();
        return;
      }
      const requestPath = `${target.pathname}${target.search}`;
      if (
        !safeSocketWrite(
          upstream,
          `${req.method ?? "GET"} ${requestPath} HTTP/${req.httpVersion}\r\n${upgradeHeaders(req, target)}\r\n\r\n`,
        )
      ) {
        client.destroy();
        return;
      }
      if (head.length > 0 && !safeSocketWrite(upstream, head)) {
        client.destroy();
        return;
      }
      upstream.pipe(client);
      client.pipe(upstream);
    });
    upstream.once("error", () => socketError(client, 502));
  } catch {
    socketError(client, 403);
  }
}

async function createProxy(): Promise<BrowserEgressProxy> {
  const sockets = new Set<Duplex>();
  const server = http.createServer(
    {
      maxHeaderSize: 16 * 1024,
      requestTimeout: 60_000,
      headersTimeout: 20_000,
      keepAliveTimeout: 5_000,
    },
    (req, res) => void forwardHttpRequest(req, res),
  );
  server.on("connection", (socket) => {
    guardBrowserProxySocket(socket, sockets);
  });
  server.on(
    "connect",
    (req, socket, head) => void forwardConnect(req, socket, head, sockets),
  );
  server.on(
    "upgrade",
    (req, socket, head) => void forwardUpgrade(req, socket, head, sockets),
  );
  server.on("clientError", (_error, socket) => socketError(socket, 400));

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo | null;
  if (!address) {
    server.close();
    throw new Error("Browser egress proxy did not bind");
  }
  return { server, url: `http://127.0.0.1:${address.port}`, sockets };
}

export async function getBrowserEgressProxyUrl(): Promise<string> {
  if (!activeProxy) {
    const created = (async () => {
      const pendingClose = closingProxy;
      if (pendingClose) await pendingClose;
      return createProxy();
    })();
    const tracked = created.catch((error) => {
      if (activeProxy === tracked) activeProxy = null;
      throw error;
    });
    activeProxy = tracked;
  }
  return (await activeProxy).url;
}

export async function closeBrowserEgressProxy(): Promise<void> {
  const pendingClose = closingProxy;
  if (pendingClose) await pendingClose;

  const pending = activeProxy;
  activeProxy = null;
  if (!pending) return;

  const closeOperation = (async () => {
    const proxy = await pending.catch(() => null);
    if (!proxy) return;
    for (const socket of [...proxy.sockets]) socket.destroy();
    proxy.sockets.clear();
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve();
      };
      const deadline = setTimeout(() => {
        proxy.server.closeAllConnections?.();
        finish();
      }, PROXY_CLOSE_TIMEOUT_MS);
      deadline.unref();
      try {
        proxy.server.close(finish);
        proxy.server.closeAllConnections?.();
      } catch {
        finish();
      }
    });
  })();
  const trackedClose = closeOperation.finally(() => {
    if (closingProxy === trackedClose) closingProxy = null;
  });
  closingProxy = trackedClose;
  await trackedClose;
}
