import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const pnpmCli = process.env.npm_execpath;

if (!pnpmCli) {
  throw new Error(
    "pnpm CLI path is unavailable. Run this check through `pnpm run check:licenses`.",
  );
}

const rawReport = execFileSync(
  process.execPath,
  [pnpmCli, "licenses", "list", "--prod", "--json"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    stdio: ["ignore", "pipe", "inherit"],
  },
);

const report = JSON.parse(rawReport) as Record<string, unknown>;
const approvedLicenses = new Set([
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "OFL-1.1",
]);
const observedLicenses = Object.keys(report).sort();
const rejectedLicenses = observedLicenses.filter(
  (license) => !approvedLicenses.has(license),
);

console.log(`Production dependency licenses: ${observedLicenses.join(", ")}.`);

if (rejectedLicenses.length > 0) {
  throw new Error(
    `Unreviewed production dependency licenses detected: ${rejectedLicenses.join(", ")}. Review the packages and update the explicit policy only when compatible with this MIT project.`,
  );
}

if (
  observedLicenses.includes("OFL-1.1") &&
  !existsSync(
    resolve(
      repositoryRoot,
      "artifacts/agentic-company-os/public/THIRD_PARTY_NOTICES.txt",
    ),
  )
) {
  throw new Error(
    "OFL-1.1 font dependencies require the distributable THIRD_PARTY_NOTICES.txt file.",
  );
}

console.log("Production dependency license policy passed.");
