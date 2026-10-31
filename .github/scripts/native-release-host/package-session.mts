import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, readdir, lstat, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import { chromium, expect, type Page } from "@playwright/test";
import { executeBoundedCommand } from "../../scripts/src/endurance/process-supervisor";
import { captureRealTaskDelivery } from "../../scripts/src/testing/real-local-first-task-viewport";

export const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
export const save = (file: string, value: unknown) =>
  writeFile(file, JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
export async function directoryDigest(root: string): Promise<string> {
  const rows = [];
  for (const entry of (await readdir(root, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name, "en"),
  )) {
    assert.ok(!entry.isSymbolicLink(), "private_fixture_link_refused");
    rows.push([
      entry.name,
      entry.isDirectory()
        ? await directoryDigest(path.join(root, entry.name))
        : hash(await readFile(path.join(root, entry.name))),
    ]);
  }
  return hash(JSON.stringify(rows));
}
export function privateEnvironment(): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    PATH: path.join(process.env.SystemRoot!, "System32"),
  };
  for (const key of [
    "SystemRoot",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "USERPROFILE",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
  ])
    if (process.env[key]) result[key] = process.env[key];
  return result;
}
export function assertSafePublicText(text: string, secrets: string[]) {
  assert.ok(
    !/[a-z]:[\\/]|\\\\[^\s\\]+\\|\b(?:Bearer|password|setupToken|operator_auth_token)\b/iu.test(
      text,
    ),
    "private_path_or_secret_label_in_public_view",
  );
  assert.ok(
    !secrets.some((value) => value.length > 8 && text.includes(value)),
    "private_literal_in_public_view",
  );
}
export async function fixtureSecrets(directory: string) {
  const values: string[] = [];
  for (const item of await readdir(path.join(directory, "secrets"), {
    withFileTypes: true,
  })) {
    assert.ok(item.isFile() && !item.isSymbolicLink());
    const file = path.join(directory, "secrets", item.name);
    assert.ok((await lstat(file)).size <= 65536);
    const value = (await readFile(file, "utf8")).trim();
    if (value.length > 8) values.push(value);
    if (item.name === "database_url") {
      const url = new URL(value);
      values.push(decodeURIComponent(url.password));
    }
  }
  return values;
}

export class PackageSession {
  child: ChildProcess | undefined;
  private log = "";
  appUrl: string | undefined;
  token: string | undefined;
  constructor(
    readonly packageRoot: string,
    readonly parent: string,
    readonly privateRoot: string,
    readonly directory?: string,
  ) {}
  node() {
    return path.join(this.packageRoot, "runtime/node/node.exe");
  }
  postgres(name: string) {
    return path.join(this.packageRoot, "runtime/postgres/bin", name + ".exe");
  }
  command(
    command: string,
    args: string[],
    extra: NodeJS.ProcessEnv = {},
    timeoutMs = 60000,
  ) {
    return executeBoundedCommand({
      command,
      args,
      cwd: this.packageRoot,
      environment: { ...privateEnvironment(), ...extra },
      timeoutMs,
      maxBufferBytes: 1048576,
    });
  }
  async start() {
    assert.equal(this.child, undefined);
    const code = `import {launchSetup} from ${JSON.stringify(pathToFileURL(path.join(this.packageRoot, "scripts/src/setup/bootstrap.mjs")).href)};const app=await launchSetup(${JSON.stringify(["--data-dir", this.parent, "--no-browser"])});process.on('message',async m=>{if(m?.action!=='stop')return;try{await app.session?.close();await app.executor.stopNative();process.disconnect();process.exit(0)}catch{process.exit(1)}});process.send({setupUrl:app.session?.url??null});`;
    const child = spawn(this.node(), ["--input-type=module", "-e", code], {
      cwd: this.packageRoot,
      env: privateEnvironment(),
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.child = child;
    for (const stream of [child.stdout, child.stderr])
      stream?.on("data", (bytes: Buffer) => {
        this.log = (this.log + bytes.toString()).slice(-262144);
      });
    return new Promise<string | null>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("owned_package_start_timeout")),
        240000,
      );
      child.once("message", (value: any) => {
        clearTimeout(timer);
        if (value?.setupUrl === null || typeof value?.setupUrl === "string")
          resolve(value.setupUrl);
        else reject(new Error("owned_package_invalid_ready_frame"));
      });
      child.once("error", () => {
        clearTimeout(timer);
        reject(new Error("owned_package_start_failed"));
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("owned_package_start_exit"));
      });
    });
  }
  async stop() {
    const child = this.child;
    if (!child) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      this.child = undefined;
      assert.equal(child.exitCode, 0, "owned_package_unexpected_exit");
      return;
    }
    const stopped = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("owned_package_shutdown_timeout")),
        45000,
      );
      child.once("exit", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve()
          : reject(new Error("owned_package_shutdown_failed"));
      });
    });
    child.send({ action: "stop" });
    await stopped;
    this.child = undefined;
    if (this.directory)
      await assert.rejects(
        access(path.join(this.directory, "database/postmaster.pid")),
      );
  }
  async bindApp(appUrl: string, directory = this.directory) {
    const origin = new URL(appUrl);
    assert.equal(origin.protocol, "http:");
    assert.equal(origin.hostname, "127.0.0.1");
    assert.equal(origin.username, "");
    assert.equal(origin.password, "");
    this.appUrl = origin.origin;
    assert.ok(directory);
    this.token = await readFile(
      path.join(directory, "secrets/operator_auth_token"),
      "utf8",
    );
    assert.ok(this.token.length > 8);
    assert.equal(
      (
        await fetch(this.appUrl + "/api/tasks", {
          redirect: "error",
          signal: AbortSignal.timeout(15000),
        })
      ).status,
      401,
    );
  }
  async api(route: string, method = "GET", body?: unknown): Promise<any> {
    assert.ok(this.appUrl && this.token);
    assert.match(route, /^[a-z][a-z0-9/-]*$/u);
    const response = await fetch(this.appUrl + "/api/" + route, {
      method,
      redirect: "error",
      headers: {
        authorization: "Bearer " + this.token,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    assert.equal(response.ok, true, "owned_api_request_failed");
    return response.json();
  }
  async healthyPaused(expected: boolean) {
    const [topology, control] = await Promise.all([
      this.api("ops/instances"),
      this.api("ops/control"),
    ]);
    const healthy = topology.instances.filter(
      (value: any) => value.effectiveState === "healthy",
    );
    assert.equal(
      healthy.filter((value: any) => value.role === "api").length,
      1,
    );
    assert.equal(
      healthy.filter(
        (value: any) => value.role === "worker" && value.schedulerEnabled,
      ).length,
      2,
    );
    assert.equal(control.emergencyStopEnabled, expected);
    if (expected) assert.equal(control.updatedBy, "native-upgrade");
  }
  async writePrivateFailure(name: string) {
    await writeFile(
      path.join(this.privateRoot, name + "-launcher.log"),
      this.log,
      { flag: "wx", mode: 0o600 },
    );
  }
}

export async function authenticatedPage(session: PackageSession) {
  assert.ok(session.appUrl && session.token);
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1024, height: 844 },
      reducedMotion: "reduce",
    });
    let outside = 0;
    const errors: string[] = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== session.appUrl) {
        outside++;
        await route.abort();
      } else await route.continue();
    });
    await context.addInitScript(() =>
      localStorage.setItem("acos.locale.v1", "en"),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(session.appUrl);
    await page.locator("#access-token").fill(session.token);
    await page.locator('form button[type="submit"]').click();
    await expect(page.locator("#access-token")).toHaveCount(0);
    return {
      browser,
      page,
      verify() {
        assert.equal(outside, 0, "external_browser_request_refused");
        assert.deepEqual(errors, [], "actual_ui_page_error");
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
export async function captureDeliveries(
  page: Page,
  session: PackageSession,
  id: number,
  caseName: "fresh" | "upgraded",
  output: string,
  secrets: string[],
) {
  const images = [];
  await page.goto(session.appUrl + "/projects/" + id);
  for (const width of [320, 1024]) {
    const capture = await captureRealTaskDelivery(page, width);
    assertSafePublicText(await page.locator("body").innerText(), secrets);
    const file = caseName + "-" + width + ".png";
    await writeFile(path.join(output, file), capture.image, {
      flag: "wx",
      mode: 0o600,
    });
    images.push({
      file,
      sha256: hash(capture.image),
      bytes: capture.image.length,
      width,
      height: 844,
      overflow: false,
      deliveryVisible: true,
    });
  }
  return images;
}
