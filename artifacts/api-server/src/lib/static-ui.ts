import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import { readBooleanEnvironment } from "./runtime-security";
import { createRateLimiter } from "./rate-limit";

export function configureStaticUi(app: Express): void {
  if (!readBooleanEnvironment("SERVE_STATIC_UI", false)) return;
  const configuredDirectory = process.env.STATIC_UI_DIR?.trim();
  if (!configuredDirectory || !path.isAbsolute(configuredDirectory)) {
    throw new Error(
      "STATIC_UI_DIR must be an absolute directory when SERVE_STATIC_UI=true.",
    );
  }
  const indexPath = path.join(configuredDirectory, "index.html");
  if (
    !fs.existsSync(configuredDirectory) ||
    !fs.statSync(configuredDirectory).isDirectory() ||
    !fs.existsSync(indexPath)
  ) {
    throw new Error("STATIC_UI_DIR does not contain a built index.html.");
  }

  const uiLimit = createRateLimiter({
    namespace: "static-ui",
    max: 1200,
    windowMs: 60_000,
  });
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    uiLimit(req, res, next);
  });
  app.use(
    express.static(configuredDirectory, {
      index: false,
      fallthrough: true,
      maxAge: 0,
      setHeaders(res, filePath) {
        if (filePath.startsWith(path.join(configuredDirectory, "assets"))) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );
  app.use((req, res, next) => {
    if (
      req.method !== "GET" ||
      req.path.startsWith("/api/") ||
      !req.accepts("html")
    ) {
      next();
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    // Limit dotfile checks to the requested file, not deployment ancestors
    // such as ~/.local/share. Hidden files inside the UI remain inaccessible.
    res.sendFile("index.html", { root: configuredDirectory });
  });
}
