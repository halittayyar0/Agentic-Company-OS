import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { mockupPreviewPlugin } from "./mockupPreviewPlugin";

const rawPort = process.env.PORT ?? "5174";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Hosted environments may override both values; local and CI builds should
// work without platform-specific environment injection.
const basePath = process.env.BASE_PATH ?? "/";
const devHost = process.env.DEV_HOST ?? "127.0.0.1";
const allowedHosts = process.env.DEV_ALLOWED_HOSTS?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export default defineConfig({
  base: basePath,
  plugins: [
    mockupPreviewPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port,
    host: devHost,
    allowedHosts,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: process.env.PREVIEW_HOST ?? "127.0.0.1",
    allowedHosts,
  },
});
