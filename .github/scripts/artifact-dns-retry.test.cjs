"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const http = require("node:http");
const { once } = require("node:events");
const { setTimeout: delay } = require("node:timers/promises");
const { mkdtemp, mkdir, copyFile, writeFile, rm } = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  createArtifactLookup,
  artifactHostname,
} = require("./artifact-dns-retry.cjs");

const hostname = "artifact.invalid";
const fault = (code) =>
  Object.assign(new Error("PRIVATE_DNS_CANARY"), { code });
const settings = { hostname, retryDelays: [1, 1], deadlineMs: 200, warn() {} };
const resolve = (lookup, host = hostname, options = { all: true }) =>
  new Promise((fulfil, reject) =>
    lookup(host, options, (error, ...values) =>
      error ? reject(error) : fulfil(values),
    ),
  );
const address = (options, callback) =>
  options.all
    ? callback(null, [{ address: "127.0.0.1", family: 4 }])
    : callback(null, "127.0.0.1", 4);

test("DNS recovery sends one POST after two preconnection failures", async () => {
  let requests = 0;
  let lookups = 0;
  const warnings = [];
  const server = http.createServer((request, response) => {
    requests++;
    assert.equal(request.method, "POST");
    request.resume();
    request.on("end", () => response.end("saved"));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const lookup = createArtifactLookup({
      ...settings,
      warn: (text) => warnings.push(text),
      lookup(_host, options, callback) {
        lookups++;
        setImmediate(() =>
          lookups < 3
            ? callback(fault(lookups === 1 ? "ENOTFOUND" : "EAI_AGAIN"))
            : address(options, callback),
        );
      },
    });
    await new Promise((fulfil, reject) => {
      const request = http.request(
        { hostname, port: server.address().port, method: "POST", lookup },
        (response) => {
          response.resume();
          response.on("end", fulfil);
        },
      );
      request.on("error", reject);
      request.end("one immutable receipt");
    });
    assert.equal(lookups, 3);
    assert.equal(requests, 1);
    assert.equal(warnings.length, 2);
    assert.ok(
      warnings.every(
        (text) => !/PRIVATE_DNS_CANARY|artifact\.invalid/u.test(text),
      ),
    );
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("persistent DNS failure remains a failure and sends zero HTTP requests", async () => {
  let lookups = 0;
  let requests = 0;
  const original = fault("ENOTFOUND");
  const server = http.createServer((_request, response) => {
    requests++;
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const lookup = createArtifactLookup({
      ...settings,
      lookup(_host, _options, callback) {
        lookups++;
        setImmediate(() => callback(original));
      },
    });
    await assert.rejects(
      new Promise((fulfil, reject) => {
        const request = http.request(
          { hostname, port: server.address().port, method: "POST", lookup },
          fulfil,
        );
        request.on("error", reject);
        request.end("never sent");
      }),
      (error) => error === original,
    );
    assert.equal(lookups, 3);
    assert.equal(requests, 0);
  } finally {
    await new Promise((done) => server.close(done));
  }
});

test("non-DNS failures retain the original error without retry", async () => {
  for (const code of ["ECONNRESET", "EACCES", "ETIMEDOUT"]) {
    let calls = 0;
    const original = fault(code);
    const lookup = createArtifactLookup({
      ...settings,
      lookup(_host, _options, callback) {
        calls++;
        callback(original);
      },
    });
    await assert.rejects(resolve(lookup), (error) => error === original);
    assert.equal(calls, 1);
  }
});

test("unrelated host lookups preserve receiver, options and result", async () => {
  const receiver = {};
  const options = { family: 6, all: true, order: "verbatim" };
  let calls = 0;
  const lookup = createArtifactLookup({
    ...settings,
    lookup(host, actual, callback) {
      assert.equal(this, receiver);
      assert.equal(host, "elsewhere.invalid");
      assert.equal(actual, options);
      calls++;
      callback(null, [{ address: "::1", family: 6 }]);
    },
  });
  const result = await new Promise((fulfil, reject) =>
    lookup.call(receiver, "elsewhere.invalid", options, (error, values) =>
      error ? reject(error) : fulfil(values),
    ),
  );
  assert.deepEqual(result, [{ address: "::1", family: 6 }]);
  assert.equal(calls, 1);
});

test("eligible lookup retains callback forms and all-address options", async () => {
  const options = { all: true, order: "verbatim", family: 6 };
  let calls = 0;
  const lookup = createArtifactLookup({
    ...settings,
    lookup(_host, actual, callback) {
      if (typeof actual === "function") {
        callback = actual;
        actual = {};
      }
      calls++;
      if (calls === 1) return callback(fault("ENOTFOUND"));
      if (actual.all) {
        assert.equal(actual, options);
        callback(null, [{ address: "::1", family: 6 }]);
      } else callback(null, "::1", 6);
    },
  });
  assert.deepEqual(await resolve(lookup, hostname, options), [
    [{ address: "::1", family: 6 }],
  ]);
  assert.deepEqual(
    await new Promise((fulfil, reject) =>
      lookup(hostname, (error, ...values) =>
        error ? reject(error) : fulfil(values),
      ),
    ),
    ["::1", 6],
  );
});

test("successful connections do not reset the process retry allowance", async () => {
  let calls = 0;
  const lookup = createArtifactLookup({
    ...settings,
    lookup(_host, options, callback) {
      calls++;
      calls % 2 ? callback(fault("ENOTFOUND")) : address(options, callback);
    },
  });
  await resolve(lookup);
  await resolve(lookup);
  await assert.rejects(resolve(lookup), { code: "ENOTFOUND" });
  assert.equal(calls, 5);
});

test("concurrent lookups share the retry allowance", async () => {
  let calls = 0;
  const lookup = createArtifactLookup({
    ...settings,
    lookup(_host, _options, callback) {
      calls++;
      setImmediate(() => callback(fault("ENOTFOUND")));
    },
  });
  const results = await Promise.allSettled([resolve(lookup), resolve(lookup)]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(calls, 4);
});

test("absolute DNS deadline returns once and ignores a late resolver callback", async () => {
  let callback;
  let delivered = 0;
  const lookup = createArtifactLookup({
    ...settings,
    deadlineMs: 15,
    lookup(_host, _options, result) {
      callback = result;
    },
  });
  await new Promise((fulfil, reject) =>
    lookup(hostname, {}, (error) => {
      delivered++;
      try {
        assert.equal(error.code, "ETIMEDOUT");
        fulfil();
      } catch (failure) {
        reject(failure);
      }
    }),
  );
  callback(null, "127.0.0.1", 4);
  await delay(5);
  assert.equal(delivered, 1);
});

test("results configuration accepts HTTPS only and reports a redacted marker", () => {
  assert.equal(
    artifactHostname("https://results-receiver.actions.githubusercontent.com/"),
    "results-receiver.actions.githubusercontent.com",
  );
  for (const input of [
    undefined,
    "http://artifact.invalid",
    "https://user:PRIVATE_DNS_CANARY@artifact.invalid",
    "not a URL PRIVATE_DNS_CANARY",
  ]) {
    assert.throws(
      () => artifactHostname(input),
      (error) => error.message === "artifact_dns_configuration_invalid",
    );
  }
});

test("expired wall-clock deadline rejects success before its timer executes", async () => {
  let complete;
  const lookup = createArtifactLookup({
    ...settings,
    deadlineMs: 10,
    lookup(_host, _options, callback) {
      complete = callback;
    },
  });
  const pending = resolve(lookup);
  const stalledUntil = performance.now() + 25;
  while (performance.now() < stalledUntil) {
    /* emulate an occupied event loop */
  }
  complete(null, [{ address: "127.0.0.1", family: 4 }]);
  await assert.rejects(pending, { code: "ETIMEDOUT" });
});

test("expired wall-clock deadline prevents an overdue retry from invoking DNS", async () => {
  let calls = 0;
  const original = fault("ENOTFOUND");
  const lookup = createArtifactLookup({
    ...settings,
    deadlineMs: 10,
    lookup(_host, options, callback) {
      calls++;
      calls === 1 ? callback(original) : address(options, callback);
    },
  });
  const pending = resolve(lookup);
  const stalledUntil = performance.now() + 25;
  while (performance.now() < stalledUntil) {
    /* retry timer precedes deadline timer */
  }
  await assert.rejects(pending, (error) => error === original);
  assert.equal(calls, 1);
});

test("NODE_OPTIONS preload works with ESM bindings and a path containing spaces", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "acos-artifact-dns-test-"));
  try {
    const folder = path.join(root, "path with spaces");
    await mkdir(folder);
    for (const file of ["artifact-dns-retry.cjs", "artifact-dns-preload.cjs"])
      await copyFile(path.join(__dirname, file), path.join(folder, file));
    const injected = path.join(folder, "fault.cjs");
    await writeFile(
      injected,
      'const dns=require("node:dns");let calls=0;dns.lookup=function(host,options,callback){if(typeof options==="function")callback=options;calls++;setImmediate(()=>calls===1?callback(Object.assign(new Error("PRIVATE_DNS_CANARY"),{code:"ENOTFOUND"})):callback(null,"127.0.0.1",4));};process.on("exit",()=>console.log(JSON.stringify({calls})));',
    );
    const main = path.join(folder, "main.mjs");
    await writeFile(
      main,
      'import {lookup} from "node:dns";lookup("artifact.invalid",(error,address,family)=>{if(error)throw error;console.log(JSON.stringify({address,family}));});',
    );
    const quoted = (file) => '"' + file.replaceAll("\\", "/") + '"';
    const result = await promisify(execFile)(process.execPath, [main], {
      timeout: 10000,
      env: {
        SystemRoot: process.env.SystemRoot || "",
        ACTIONS_RESULTS_URL: "https://artifact.invalid",
        NODE_OPTIONS:
          "--require=" +
          quoted(injected) +
          " --require=" +
          quoted(path.join(folder, "artifact-dns-preload.cjs")),
      },
    });
    const rows = result.stdout
      .trim()
      .split(/\r?\n/u)
      .map((line) => JSON.parse(line));
    assert.deepEqual(rows, [{ address: "127.0.0.1", family: 4 }, { calls: 2 }]);
    assert.ok(
      !/PRIVATE_DNS_CANARY|artifact\.invalid|path with spaces/u.test(
        result.stderr,
      ),
    );
  } finally {
    const owned = path.resolve(root);
    assert.equal(path.dirname(owned), path.resolve(os.tmpdir()));
    assert.ok(path.basename(owned).startsWith("acos-artifact-dns-test-"));
    await rm(owned, { recursive: true, force: true });
  }
});
