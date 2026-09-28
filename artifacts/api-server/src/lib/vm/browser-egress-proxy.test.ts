import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  closeBrowserEgressProxy,
  getBrowserEgressProxyUrl,
  guardBrowserProxySocket,
} from "./browser-egress-proxy";
import { resolveSafeBrowserTarget } from "./browser-network-policy";

test("browser DNS policy pins a public answer and rejects mixed private answers", async () => {
  const pinned = await resolveSafeBrowserTarget("public.example", async () => [
    { address: "8.8.8.8", family: 4 },
    { address: "1.1.1.1", family: 4 },
  ]);
  assert.deepEqual(pinned, {
    hostname: "public.example",
    address: "8.8.8.8",
    family: 4,
  });

  await assert.rejects(
    resolveSafeBrowserTarget("rebinding.example", async () => [
      { address: "8.8.8.8", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]),
    /ozel veya yerel/i,
  );
});

test("proxy tunnel sockets absorb Windows revocation write failures", () => {
  const sockets = new Set<PassThrough>();
  const socket = new PassThrough();
  guardBrowserProxySocket(socket, sockets);
  assert.equal(sockets.has(socket), true);

  const error = Object.assign(new Error("write ECONNABORTED"), {
    code: "ECONNABORTED",
  });
  assert.doesNotThrow(() => socket.emit("error", error));
  assert.equal(sockets.has(socket), false);
  assert.equal(socket.destroyed, true);
});

test("egress proxy close is bounded, concurrent, and reusable", async () => {
  const firstUrl = await getBrowserEgressProxyUrl();
  await Promise.all([
    closeBrowserEgressProxy(),
    closeBrowserEgressProxy(),
    closeBrowserEgressProxy(),
  ]);

  const secondUrl = await getBrowserEgressProxyUrl();
  assert.match(firstUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(secondUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  await closeBrowserEgressProxy();
});

test("loopback egress proxy refuses private HTTP targets", async (t) => {
  const proxyUrl = new URL(await getBrowserEgressProxyUrl());
  t.after(closeBrowserEgressProxy);

  const response = await new Promise<{
    status: number;
    body: string;
  }>((resolve, reject) => {
    const req = http.request(
      {
        host: proxyUrl.hostname,
        port: Number(proxyUrl.port),
        method: "GET",
        path: "http://127.0.0.1:65535/private-target",
        headers: { Host: "127.0.0.1:65535" },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.once("error", reject);
    req.end();
  });

  assert.equal(response.status, 403);
  assert.match(response.body, /blocked/i);
});

test("loopback egress proxy refuses private HTTPS CONNECT tunnels", async (t) => {
  const proxyUrl = new URL(await getBrowserEgressProxyUrl());
  t.after(closeBrowserEgressProxy);

  const response = await new Promise<string>((resolve, reject) => {
    const socket = net.connect({
      host: proxyUrl.hostname,
      port: Number(proxyUrl.port),
    });
    let data = "";
    socket.setEncoding("utf8");
    socket.once("connect", () => {
      socket.write(
        "CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n",
      );
    });
    socket.on("data", (chunk) => {
      data += chunk;
    });
    socket.once("end", () => resolve(data));
    socket.once("close", () => resolve(data));
    socket.once("error", reject);
  });

  assert.match(response, /^HTTP\/1\.1 403 Forbidden/m);
});
