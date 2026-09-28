import assert from "node:assert/strict";
import test from "node:test";
import {
  inspectPhoneAccess,
  configurePhoneAccess,
  verifyPhoneAccess,
} from "./phone-access";

test("phone readiness requires public UI, rejected anonymous API and authorized API", async () => {
  const connection = {
    url: "https://desk.example.ts.net:8443",
    target: "http://127.0.0.1:5000",
    port: 5000,
  };
  const calls: string[] = [];
  const request: typeof fetch = async (url, init) => {
    assert.equal(init?.redirect, "error");
    const parsed = new URL(String(url));
    const authorized =
      new Headers(init?.headers).get("authorization") === "Bearer fixture";
    calls.push(`${parsed.pathname}:${authorized}`);
    return new Response(null, {
      status: parsed.pathname === "/" || authorized ? 200 : 401,
    });
  };
  await verifyPhoneAccess(connection, "fixture", request);
  assert.deepEqual(calls, ["/:false", "/api/skills:false", "/api/skills:true"]);
  await assert.rejects(
    verifyPhoneAccess(
      connection,
      "fixture",
      async () => new Response(null, { status: 200 }),
    ),
    /NOT_READY/,
  );
});
test("private phone setup requires a logged-in device and preserves unrelated listeners", async () => {
  const calls: string[][] = [];
  const run = async (_command: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "status")
      return JSON.stringify({
        BackendState: "Running",
        Self: { DNSName: "desk.example.ts.net." },
      });
    if (args.includes("status"))
      return JSON.stringify({ TCP: { "443": { HTTPS: true } } });
    return "";
  };
  const connection = await inspectPhoneAccess(5000, run);
  assert.equal(connection.url, "https://desk.example.ts.net:8443");
  await configurePhoneAccess(connection, run);
  assert.deepEqual(calls.at(-1), [
    "serve",
    "--bg",
    "--https=8443",
    "http://127.0.0.1:5000",
  ]);
  await assert.rejects(
    inspectPhoneAccess(5000, async () =>
      JSON.stringify({ BackendState: "NeedsLogin" }),
    ),
    /PHONE_LOGIN_REQUIRED/,
  );
  await assert.rejects(
    inspectPhoneAccess(5000, async (_cmd, args) =>
      args[0] === "status"
        ? JSON.stringify({
            BackendState: "Running",
            Self: { DNSName: "desk.example.ts.net." },
          })
        : JSON.stringify({
            TCP: { "8443": { HTTPS: true } },
            Web: {
              "desk.example.ts.net:8443": {
                Handlers: { "/": { Proxy: "http://127.0.0.1:9000" } },
              },
            },
          }),
    ),
    /PHONE_PORT_IN_USE/,
  );
});
