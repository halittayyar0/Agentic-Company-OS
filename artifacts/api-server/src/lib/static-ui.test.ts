import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import express from "express";
import { configureStaticUi } from "./static-ui";

for (const parent of ["application", ".application"]) {
  test(`static UI loads direct SPA routes beneath ${parent} without exposing private files`, async () => {
    const temporaryRoot = await mkdtemp(
      path.join(os.tmpdir(), "acos-static-ui-"),
    );
    const directory = path.join(temporaryRoot, parent, "public");
    await mkdir(path.join(directory, "assets"), { recursive: true });
    await writeFile(
      path.join(directory, "index.html"),
      "<h1>Installed UI</h1>",
    );
    await writeFile(
      path.join(directory, "assets", "app.js"),
      "/* built asset */",
    );
    await writeFile(path.join(directory, ".private"), "PRIVATE_UI_SENTINEL");
    await writeFile(
      path.join(temporaryRoot, "outside.txt"),
      "OUTSIDE_UI_SENTINEL",
    );
    const originalEnabled = process.env.SERVE_STATIC_UI;
    const originalDirectory = process.env.STATIC_UI_DIR;
    const app = express();
    try {
      process.env.SERVE_STATIC_UI = "true";
      process.env.STATIC_UI_DIR = directory;
      configureStaticUi(app);
    } finally {
      if (originalEnabled === undefined) delete process.env.SERVE_STATIC_UI;
      else process.env.SERVE_STATIC_UI = originalEnabled;
      if (originalDirectory === undefined) delete process.env.STATIC_UI_DIR;
      else process.env.STATIC_UI_DIR = originalDirectory;
    }
    app.use((_req, res) => res.sendStatus(404));
    const server = app.listen(0, "127.0.0.1");
    try {
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address !== "string");
      const base = `http://127.0.0.1:${address.port}`;
      for (const route of ["/", "/skills", "/projects/42/operations"]) {
        const response = await fetch(base + route, {
          headers: { Accept: "text/html" },
        });
        assert.equal(response.status, 200, `Direct navigation to ${route}`);
        assert.equal(await response.text(), "<h1>Installed UI</h1>");
        assert.equal(response.headers.get("cache-control"), "no-cache");
      }
      const asset = await fetch(base + "/assets/app.js");
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), "/* built asset */");
      assert.match(asset.headers.get("cache-control") ?? "", /immutable/);

      for (const route of ["/.private", "/%2e%2e%2foutside.txt"]) {
        const response = await fetch(base + route);
        assert.doesNotMatch(
          await response.text(),
          /(?:PRIVATE|OUTSIDE)_UI_SENTINEL/,
        );
      }
      assert.equal((await fetch(base + "/api/missing")).status, 404);
      assert.equal(
        (await fetch(base + "/skills", { method: "POST" })).status,
        404,
      );
      assert.equal(
        (
          await fetch(base + "/skills", {
            headers: { Accept: "application/json" },
          })
        ).status,
        404,
      );
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      const resolvedRoot = await realpath(temporaryRoot);
      assert.equal(path.dirname(resolvedRoot), await realpath(os.tmpdir()));
      assert.ok(path.basename(resolvedRoot).startsWith("acos-static-ui-"));
      await rm(resolvedRoot, { recursive: true, force: true });
    }
  });
}
