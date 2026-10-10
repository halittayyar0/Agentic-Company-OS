import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Plugin } from "vite";

/** Private build evidence; never emitted into the served public directory. */
export function bundleBudgetManifest(
  workspaceRoot: string,
  outputPath: string,
): Plugin {
  let outputDirectory: string;
  let chunks: { fileName: string; modules: string[] }[] = [];
  return {
    name: "acos-bundle-budget-manifest",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      outputDirectory = path.resolve(config.root, config.build.outDir);
    },
    generateBundle(_options, bundle) {
      chunks = Object.values(bundle)
        .flatMap((entry) => {
          if (entry.type !== "chunk") return [];
          const modules = Object.keys(entry.modules)
            .flatMap((id) => {
              if (id.startsWith("\0") || id.includes("node_modules")) return [];
              const relative = path.relative(workspaceRoot, id.split("?")[0]);
              if (
                !relative ||
                relative === ".." ||
                relative.startsWith(".." + path.sep) ||
                path.isAbsolute(relative)
              )
                return [];
              return [relative.replaceAll("\\", "/")];
            })
            .sort();
          return [
            {
              fileName: entry.fileName,
              modules,
            },
          ];
        })
        .sort((a, b) => a.fileName.localeCompare(b.fileName));
    },
    async closeBundle() {
      // Vite's later output hooks can still replace preload placeholders after
      // generateBundle. Bind ownership to the final written bytes, not the
      // intermediate Rollup code string.
      const finalChunks = await Promise.all(
        chunks.map(async (chunk) => ({
          ...chunk,
          sha256: createHash("sha256")
            .update(await readFile(path.join(outputDirectory, chunk.fileName)))
            .digest("hex"),
        })),
      );
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(
        outputPath,
        JSON.stringify({ schemaVersion: 1, chunks: finalChunks }, null, 2) +
          "\n",
      );
    },
  };
}
