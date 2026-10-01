import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT ?? "5173";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Replit injects these values at runtime. Sensible defaults keep local builds,
// GitHub Actions, and first-time contributor setup deterministic.
const basePath = process.env.BASE_PATH ?? "/";
const devHost = process.env.DEV_HOST ?? "127.0.0.1";
const previewHost = process.env.PREVIEW_HOST ?? "127.0.0.1";
const allowedHosts = process.env.DEV_ALLOWED_HOSTS?.split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const localApiTarget =
  process.env.LOCAL_API_TARGET ??
  (process.env.REPL_ID === undefined ? "http://127.0.0.1:5000" : undefined);

export default defineConfig({
  base: basePath,
  plugins: [
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
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "attached_assets",
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          const moduleId = id.replaceAll("\\", "/");
          if (moduleId.endsWith("/src/lib/completion-review-view.ts"))
            return "completion-review-view";
          if (!moduleId.includes("/node_modules/")) return undefined;
          if (
            moduleId.includes("/recharts/") ||
            moduleId.includes("/d3-") ||
            moduleId.includes("/victory-vendor/")
          ) {
            return "vendor-charts";
          }
          if (moduleId.includes("/framer-motion/")) return "vendor-motion";
          if (
            moduleId.includes("/@radix-ui/") ||
            moduleId.includes("/cmdk/") ||
            moduleId.includes("/vaul/") ||
            moduleId.includes("/lucide-react/")
          ) {
            return "vendor-ui";
          }
          // React/query and controls/icons are each loaded together by the
          // shell. Co-locate them to share compression and avoid extra requests.
          return "vendor-core";
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: devHost,
    allowedHosts,
    fs: {
      strict: true,
    },
    // Optional local-dev proxy: when LOCAL_API_TARGET is set (e.g.
    // http://localhost:5000) every /api request is forwarded to the locally
    // running api-server. Unused on Replit, where routing is external.
    proxy: localApiTarget
      ? {
          "/api": {
            target: localApiTarget,
            changeOrigin: true,
          },
        }
      : undefined,
  },
  preview: {
    port,
    host: previewHost,
    allowedHosts,
    proxy: localApiTarget
      ? {
          "/api": {
            target: localApiTarget,
            changeOrigin: true,
          },
        }
      : undefined,
  },
});
