import path from "path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin } from "vite";
import { minify } from "terser";
import { bundleBudgetManifest } from "./bundle-budget-manifest";

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

/** Compress shared dependencies after the normal browser-target transform.
 * Application chunks retain the compiler used by the source ownership checks. */
function compressSharedVendors(): Plugin {
  return {
    name: "acos-compress-shared-vendors",
    apply: "build",
    enforce: "post",
    renderChunk: {
      order: "post",
      async handler(code, chunk) {
        if (!/^vendor-(core|ui)$/.test(chunk.name)) return null;
        const result = await minify(code, {
          module: true,
          sourceMap: true,
          compress: { passes: 2, unsafe: false },
          mangle: { properties: false },
          format: { ascii_only: false, comments: "some" },
        });
        if (!result.code) throw new Error("Shared vendor compression failed");
        return {
          code: result.code,
          map:
            typeof result.map === "string"
              ? result.map
              : result.map
                ? JSON.stringify(result.map)
                : null,
        };
      },
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    compressSharedVendors(),
    bundleBudgetManifest(
      path.resolve(import.meta.dirname, "../.."),
      path.resolve(import.meta.dirname, "dist/bundle-budget-manifest.json"),
    ),
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
    modulePreload: {
      resolveDependencies(_filename, dependencies, context) {
        // The shell statically imports both vendors. Do not repeat their
        // paths in every route's dynamic preload metadata. Keep initial HTML
        // preloads and all other hosts unchanged; transfer budgets count both.
        return context.hostType === "js" &&
          /(?:^|\/)index-[^/]+\.js$/.test(context.hostId)
          ? dependencies.filter(
              (dependency) =>
                !/(?:^|\/)vendor-(?:core|ui)-[^/]+\.js$/.test(dependency),
            )
          : dependencies;
      },
    },
    rollupOptions: {
      output: {
        // Repeated content-hash paths compress better with a smaller alphabet.
        // Keep the same eight-character names and SHA-256 evidence manifest.
        hashCharacters: "hex",
        manualChunks(id) {
          const moduleId = id.replaceAll("\\", "/");
          // Preserve the entry's shared controls and locale provider in the
          // shell when a feature view gets its own chunk.
          if (
            moduleId ===
            path
              .resolve(import.meta.dirname, "index.html")
              .replaceAll("\\", "/")
          )
            return "index";
          if (moduleId.endsWith("/src/lib/completion-review-view.ts"))
            return "completion-review-view";
          // Recovery controls also use the pure studio formatter. Sharing
          // this tiny owner avoids importing the entire project view for it.
          if (moduleId.endsWith("/src/lib/project-studio-copy.ts"))
            return "project-studio-copy";
          // Keep the existing shared language-file recovery owner separate.
          if (
            moduleId.endsWith("/src/components/i18n/language-pack-status.tsx")
          )
            return "language-pack-status";
          // Only the new download implementation belongs to this feature.
          // Existing report rendering and studio copy retain their budgets.
          if (
            moduleId.endsWith(
              "/src/components/studio/project-delivery-download.tsx",
            ) ||
            moduleId.endsWith("/src/lib/project-delivery-export.ts") ||
            moduleId.endsWith("/src/lib/delivery-download-copy.ts")
          )
            return "delivery-download";
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
