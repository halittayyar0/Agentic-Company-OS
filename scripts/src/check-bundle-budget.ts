import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const outputDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../artifacts/agentic-company-os/dist/public/assets",
);
const sourceDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../artifacts/agentic-company-os/src",
);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filePath);
    return /\.[jt]sx?$/u.test(entry.name) ? [filePath] : [];
  });
}

function checkExcludedUiSources(): void {
  const css = readFileSync(resolve(sourceDirectory, "index.css"), "utf8");
  const excludedPaths = new Set<string>();
  for (const [, pattern] of css.matchAll(/@source not "([^"\n]+)";/gu)) {
    const brace = pattern.match(/\{([^{}]+)\}/u);
    const paths = brace
      ? brace[1].split(",").map((name) => pattern.replace(brace[0], name))
      : [pattern];
    for (const path of paths) {
      if (/[{}*?]/u.test(path))
        throw new Error(`CSS exclusion must name exact source files: ${path}`);
      excludedPaths.add(resolve(sourceDirectory, path));
    }
  }
  for (const excludedPath of excludedPaths) {
    if (!existsSync(excludedPath)) {
      throw new Error(`Excluded UI source no longer exists: ${excludedPath}`);
    }
  }

  const liveImports: string[] = [];
  for (const filePath of sourceFiles(sourceDirectory)) {
    if (excludedPaths.has(filePath)) continue;
    const source = readFileSync(filePath, "utf8");
    const imports = source.matchAll(
      /(?:from\s+|import\s*\()\s*["']([^"']+)["']/gu,
    );
    for (const [, specifier] of imports) {
      const target = specifier.startsWith("@/")
        ? resolve(sourceDirectory, `${specifier.slice(2)}.tsx`)
        : specifier.startsWith(".")
          ? resolve(dirname(filePath), `${specifier}.tsx`)
          : null;
      if (target && excludedPaths.has(target)) {
        liveImports.push(`${specifier} from ${filePath}`);
      }
    }
  }
  if (liveImports.length > 0) {
    throw new Error(
      `Live sources import CSS-excluded UI components:\n${liveImports.join("\n")}`,
    );
  }
}

checkExcludedUiSources();

const budgets = {
  // Shared route code plus the largest selected pack for each localized route
  // have an explicit total transfer ceiling. Cap all packs on disk separately.
  // Durable operator recovery adds ~11 KiB raw / 3.3 KiB gzip over the
  // meeting-turn inbox checkpoint, including one selected recovery pack.
  // Allow 15 KB raw / 4 KB gzip for this feature; individual assets, media,
  // and existing language-family budgets stay fixed.
  // User-requested permission controls, executable extension editor and source
  // review add separately loaded components and one customization locale pack.
  // Give this new scope 30 KB raw / 10 KB gzip; retain the original base limit.
  customizationRawBytes: 30_000,
  customizationGzipBytes: 10_000,
  // Browser-only checks are a separate lazy Skills-page chunk. Bound their
  // transfer cost without increasing the budget for existing routes.
  localUtilityRawBytes: 29_000,
  localUtilityGzipBytes: 13_000,
  // In-place model-check loading/error/retry states add a bounded allowance to
  // this one lazy notice. Keep total, existing route, media and locale caps fixed.
  providerSetupRawBytes: 2_000,
  providerSetupGzipBytes: 1_000,
  // Both existing project routes add lazy-import and Suspense wiring. Keep
  // that small integration allowance separate from the old-route ceiling.
  providerSetupIntegrationGzipBytes: 250,
  // The first-project model check changes only the Settings route and its
  // selected language pack. Measure their growth against the v0.3.2 build
  // instead of raising the allowance for unrelated code.
  firstTaskModelCheckGzipBytes: 450,
  // Budget resume is one conditional recovery chunk plus selected studio-copy
  // growth and bounded route/API wiring. Existing route ceilings stay fixed.
  budgetResumeRawBytes: 13_000,
  budgetResumeGzipBytes: 4_500,
  // Two review assets and selected trace-pack growth have a separate cap.
  // Every previous total/base/asset/media ceiling remains unchanged.
  completionReviewRawBytes: 10_000,
  completionReviewGzipBytes: 4_000,
  // User-requested live mascots have a separate measured allowance. Existing
  // base, total, individual asset, language-family and media ceilings stay fixed.
  keeperLiveRawBytes: 10_000,
  keeperLiveGzipBytes: 4_000,
  totalCodeRawBytes: 1_345_000 + 30_000 + 29_000,
  // The separately requested 30-skill library adds a lazy route and a small
  // draft helper. Preserve the previous 396 KB ceiling for all other code;
  // bound this new feature independently to 2.5 KB gzip / 8 KB raw below.
  baseCodeGzipBytes: 396_000,
  skillLibraryRawBytes: 8_000,
  skillLibraryGzipBytes: 2_500,
  totalCodeGzipBytes: 398_500 + 10_000 + 13_000 + 450,
  allHomeLocaleRawBytes: 60_000,
  allHomeLocaleGzipBytes: 25_000,
  allProjectLocaleRawBytes: 25_000,
  allProjectLocaleGzipBytes: 12_000,
  allNewProjectLocaleRawBytes: 35_000,
  allNewProjectLocaleGzipBytes: 16_000,
  allEmergencyLocaleRawBytes: 15_000,
  allEmergencyLocaleGzipBytes: 8_000,
  allDirectoryLocaleRawBytes: 60_000,
  allDirectoryLocaleGzipBytes: 25_000,
  allShellLocaleRawBytes: 60_000,
  allShellLocaleGzipBytes: 25_000,
  allNewAgentLocaleRawBytes: 75_000,
  allNewAgentLocaleGzipBytes: 35_000,
  allAuthLocaleRawBytes: 15_000,
  allAuthLocaleGzipBytes: 8_000,
  singleJavaScriptRawBytes: 380_000,
  singleJavaScriptGzipBytes: 140_000,
  singleCssGzipBytes: 45_000,
  totalMediaRawBytes: 300_000,
  singleMediaRawBytes: 160_000,
} as const;

function formatBytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

if (!existsSync(outputDirectory)) {
  throw new Error(
    `Frontend build output was not found at ${outputDirectory}. Run the production build first.`,
  );
}

const assets = readdirSync(outputDirectory)
  .filter((fileName) =>
    /\.(?:css|js|avif|gif|jpe?g|png|svg|webp|woff2?)$/iu.test(fileName),
  )
  .map((fileName) => {
    const contents = readFileSync(resolve(outputDirectory, fileName));
    return {
      fileName,
      rawBytes: contents.byteLength,
      gzipBytes: gzipSync(contents, { level: 9 }).byteLength,
    };
  })
  .sort((left, right) => right.gzipBytes - left.gzipBytes);

const codeAssets = assets.filter((asset) =>
  /\.(?:css|js)$/iu.test(asset.fileName),
);
const languageLocales = [
  "tr",
  "en",
  "de",
  "ru",
  "zh-CN",
  "zh-TW",
  "ar",
] as const;
function languagePackAssets(
  prefix: string,
  page: string,
  locales: readonly string[] = languageLocales,
) {
  return locales.map((locale) => {
    const matches = codeAssets.filter(
      (asset) =>
        asset.fileName.startsWith(`${prefix}${locale}-`) &&
        asset.fileName.endsWith(".js"),
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one dynamic ${page} locale chunk for ${locale}, found ${matches.length}.`,
      );
    }
    return matches[0];
  });
}
const homeLocaleAssets = languagePackAssets("", "home");
const projectLocaleAssets = languagePackAssets("projects-", "projects");
const directoryLocaleAssets = languagePackAssets(
  "directory-",
  "expert directory",
);
const newAgentLocaleAssets = languagePackAssets("new-expert-", "new expert");
// Every shell, including Turkish, is selected on demand. Keep the same byte
// ceilings while checking that all seven shipped language chunks exist.
const shellLocaleAssets = languagePackAssets("shell-", "shell");
const approvalLocaleAssets = languagePackAssets("approval-", "approvals");
const settingsLocaleAssets = languagePackAssets("settings-", "settings");
const settingsRouteAssets = codeAssets.filter(
  (asset) =>
    asset.fileName.startsWith("settings-") &&
    !settingsLocaleAssets.includes(asset),
);
if (settingsRouteAssets.length !== 1) {
  throw new Error("Expected one Settings route asset.");
}
const firstTaskModelCheckGzipBytes =
  Math.max(0, settingsRouteAssets[0].gzipBytes - 4_698) +
  Math.max(
    0,
    Math.max(...settingsLocaleAssets.map((asset) => asset.gzipBytes)) - 2_624,
  );
if (firstTaskModelCheckGzipBytes > budgets.firstTaskModelCheckGzipBytes) {
  throw new Error(
    "First-project model check exceeds its Settings-only budget.",
  );
}
const customizationLocaleAssets = languagePackAssets(
  "customization-",
  "workspace customization",
);
const expertDetailLocaleAssets = languagePackAssets(
  "expert-detail-",
  "expert detail",
);
const traceLocaleAssets = languagePackAssets(
  "trace-",
  "activity and delegation records",
);
const meetingTurnLocaleAssets = languagePackAssets(
  "meeting-turn-",
  "meeting turn recovery",
);
const operationsLocaleAssets = languagePackAssets("operations-", "operations");
const meetingLocaleAssets = languagePackAssets("meetings-", "project meetings");
const studioLocaleAssets = languagePackAssets("studio-", "project studio");
const expertChatLocaleAssets = languagePackAssets("chat-", "expert chat");
const computerLocaleAssets = languagePackAssets(
  "computer-",
  "computer workspace",
);
const fileLocaleAssets = languagePackAssets("files-", "workspace files");
const browserLocaleAssets = languagePackAssets("browser-", "browser workbench");
const operatorLocaleAssets = languagePackAssets(
  "operator-",
  "operator recovery",
);
const roomLocaleAssets = languagePackAssets("room-", "company room");
const workforceLocaleAssets = languagePackAssets("workforce-", "team studio");
const authLocaleAssets = languagePackAssets("auth-", "sign in");
const newProjectLocaleAssets = languagePackAssets(
  "new-project-",
  "new project",
);
// English safety copy remains in the shell so controls stay usable if a
// selected language asset cannot be loaded.
const emergencyLocaleAssets = languageLocales
  .filter((locale) => locale !== "en")
  .map((locale) => {
    const matches = codeAssets.filter(
      (asset) =>
        asset.fileName.startsWith(`emergency-${locale}-`) &&
        asset.fileName.endsWith(".js"),
    );
    if (matches.length !== 1) {
      throw new Error(
        `Expected exactly one dynamic emergency locale chunk for ${locale}, found ${matches.length}.`,
      );
    }
    return matches[0];
  });
const localeAssetNames = new Set(
  [
    ...homeLocaleAssets,
    ...projectLocaleAssets,
    ...newProjectLocaleAssets,
    ...emergencyLocaleAssets,
    ...directoryLocaleAssets,
    ...authLocaleAssets,
    ...workforceLocaleAssets,
    ...approvalLocaleAssets,
    ...roomLocaleAssets,
    ...settingsLocaleAssets,
    ...customizationLocaleAssets,
    ...expertDetailLocaleAssets,
    ...expertChatLocaleAssets,
    ...studioLocaleAssets,
    ...traceLocaleAssets,
    ...meetingTurnLocaleAssets,
    ...meetingLocaleAssets,
    ...operationsLocaleAssets,
    ...computerLocaleAssets,
    ...fileLocaleAssets,
    ...browserLocaleAssets,
    ...operatorLocaleAssets,
    ...newAgentLocaleAssets,
    ...shellLocaleAssets,
  ].map((asset) => asset.fileName),
);
const sharedCodeAssets = codeAssets.filter(
  (asset) => !localeAssetNames.has(asset.fileName),
);
const mediaAssets = assets.filter(
  (asset) => !/\.(?:css|js)$/iu.test(asset.fileName),
);

if (codeAssets.length === 0) {
  throw new Error(
    `No JavaScript or CSS assets were found in ${outputDirectory}.`,
  );
}

const sharedCodeRawBytes = sharedCodeAssets.reduce(
  (total, asset) => total + asset.rawBytes,
  0,
);
const sharedCodeGzipBytes = sharedCodeAssets.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
);
const totalCodeRawBytes =
  sharedCodeRawBytes +
  Math.max(...studioLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...traceLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...meetingTurnLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...meetingLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...operationsLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...browserLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...operatorLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...fileLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...computerLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...expertChatLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...expertDetailLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...settingsLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...customizationLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...roomLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...approvalLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...workforceLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...homeLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...projectLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...newProjectLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...emergencyLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...directoryLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...authLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...newAgentLocaleAssets.map((asset) => asset.rawBytes)) +
  Math.max(...shellLocaleAssets.map((asset) => asset.rawBytes));
const totalCodeGzipBytes =
  sharedCodeGzipBytes +
  Math.max(...studioLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...traceLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...meetingTurnLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...meetingLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...operationsLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...browserLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...operatorLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...fileLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...computerLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...expertChatLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...expertDetailLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...settingsLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...customizationLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...roomLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...approvalLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...workforceLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...homeLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...projectLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...newProjectLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...emergencyLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...directoryLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...authLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...newAgentLocaleAssets.map((asset) => asset.gzipBytes)) +
  Math.max(...shellLocaleAssets.map((asset) => asset.gzipBytes));
const allHomeLocaleRawBytes = homeLocaleAssets.reduce(
  (total, asset) => total + asset.rawBytes,
  0,
);
const allHomeLocaleGzipBytes = homeLocaleAssets.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
);
const allProjectLocaleRawBytes = projectLocaleAssets.reduce(
  (total, asset) => total + asset.rawBytes,
  0,
);
const allProjectLocaleGzipBytes = projectLocaleAssets.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
);
const allNewProjectLocaleRawBytes = newProjectLocaleAssets.reduce(
  (total, asset) => total + asset.rawBytes,
  0,
);
const allNewProjectLocaleGzipBytes = newProjectLocaleAssets.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
);
const allEmergencyLocaleRawBytes = emergencyLocaleAssets.reduce(
  (total, asset) => total + asset.rawBytes,
  0,
);
const allEmergencyLocaleGzipBytes = emergencyLocaleAssets.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
);
const violations: string[] = [];
if (
  operatorLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) >
    18000 ||
  operatorLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) > 8000
) {
  violations.push(
    "Operator recovery language packs exceed 18 KB raw / 8 KB gzip.",
  );
}
if (
  browserLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) > 60000 ||
  browserLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) > 26000
)
  violations.push("Browser language packs exceed their aggregate budget.");
if (
  fileLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) > 60000 ||
  fileLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) > 26000
)
  violations.push("File language packs exceed their aggregate budget.");
if (
  computerLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) >
    60000 ||
  computerLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) > 26000
)
  violations.push("Computer language packs exceed their aggregate budget.");
if (
  expertChatLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) >
    70000 ||
  expertChatLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) >
    30000
)
  violations.push("Expert chat language packs exceed their aggregate budget.");
if (
  expertDetailLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) >
    60000 ||
  expertDetailLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) >
    26000
)
  violations.push(
    "Expert detail language packs exceed their aggregate budget.",
  );
if (
  settingsLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) >
    70000 ||
  settingsLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) > 26000
)
  violations.push("Settings language packs exceed their aggregate budget.");
if (
  customizationLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) >
    70000 ||
  customizationLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) >
    24000
)
  violations.push(
    "Customization language packs exceed their aggregate budget.",
  );
if (
  roomLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) > 50000 ||
  roomLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) > 22000
)
  violations.push("Company room language packs exceed their aggregate budget.");
if (
  approvalLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) >
    50000 ||
  approvalLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) > 22000
)
  violations.push("Approval language packs exceed their aggregate budget.");
if (
  workforceLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) >
    40000 ||
  workforceLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) > 18000
)
  violations.push("Team studio language packs exceed their aggregate budget.");
if (
  traceLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) > 65000 ||
  traceLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) > 25000
) {
  violations.push(
    "Activity and delegation language packs exceed their aggregate budget.",
  );
}
if (
  studioLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) > 65000 ||
  studioLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) > 25000
)
  violations.push(
    "Project studio language packs exceed their aggregate budget.",
  );
const allShellLocaleRawBytes = shellLocaleAssets.reduce(
  (total, asset) => total + asset.rawBytes,
  0,
);
const allShellLocaleGzipBytes = shellLocaleAssets.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
);
if (
  allShellLocaleRawBytes > budgets.allShellLocaleRawBytes ||
  allShellLocaleGzipBytes > budgets.allShellLocaleGzipBytes
)
  violations.push("Shell language packs exceed their aggregate budget.");
const allNewAgentLocaleRawBytes = newAgentLocaleAssets.reduce(
  (total, asset) => total + asset.rawBytes,
  0,
);
const allNewAgentLocaleGzipBytes = newAgentLocaleAssets.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
);
if (
  allNewAgentLocaleRawBytes > budgets.allNewAgentLocaleRawBytes ||
  allNewAgentLocaleGzipBytes > budgets.allNewAgentLocaleGzipBytes
)
  violations.push("New expert language packs exceed their aggregate budget.");
const allAuthLocaleRawBytes = authLocaleAssets.reduce(
  (total, asset) => total + asset.rawBytes,
  0,
);
const allAuthLocaleGzipBytes = authLocaleAssets.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
);
if (
  allAuthLocaleRawBytes > budgets.allAuthLocaleRawBytes ||
  allAuthLocaleGzipBytes > budgets.allAuthLocaleGzipBytes
) {
  violations.push(
    `all sign-in language packs exceed their aggregate budget: ${formatBytes(allAuthLocaleRawBytes)} raw / ${formatBytes(allAuthLocaleGzipBytes)} gzip`,
  );
}
const allDirectoryLocaleRawBytes = directoryLocaleAssets.reduce(
  (total, asset) => total + asset.rawBytes,
  0,
);
const allDirectoryLocaleGzipBytes = directoryLocaleAssets.reduce(
  (total, asset) => total + asset.gzipBytes,
  0,
);

if (allDirectoryLocaleRawBytes > budgets.allDirectoryLocaleRawBytes) {
  violations.push(
    `all directory language packs raw ${formatBytes(allDirectoryLocaleRawBytes)} exceeds ${formatBytes(budgets.allDirectoryLocaleRawBytes)}`,
  );
}
if (allDirectoryLocaleGzipBytes > budgets.allDirectoryLocaleGzipBytes) {
  violations.push(
    `all directory language packs gzip ${formatBytes(allDirectoryLocaleGzipBytes)} exceeds ${formatBytes(budgets.allDirectoryLocaleGzipBytes)}`,
  );
}

const totalMediaRawBytes = mediaAssets.reduce(
  (total, asset) => total + asset.rawBytes,
  0,
);

const skillLibraryAssets = codeAssets.filter((asset) =>
  /^(?:skills|skill-draft)-[^/]+\.js$/u.test(asset.fileName),
);
const skillLibraryRawBytes = skillLibraryAssets.reduce(
  (sum, asset) => sum + asset.rawBytes,
  0,
);
const skillLibraryGzipBytes = skillLibraryAssets.reduce(
  (sum, asset) => sum + asset.gzipBytes,
  0,
);
if (
  skillLibraryRawBytes > budgets.skillLibraryRawBytes ||
  skillLibraryGzipBytes > budgets.skillLibraryGzipBytes
) {
  violations.push(
    `skill library exceeds its 8 KB raw / 2.5 KB gzip feature budget`,
  );
}
const customizationCodeAssets = codeAssets.filter((asset) =>
  /^(?:extension-library|execution-policy|source-workspaces|customization-copy)-/.test(
    asset.fileName,
  ),
);
// Generated API bindings and lazy import plumbing share existing chunks;
// reserve a fixed 4 KB raw / 1.5 KB gzip integration allowance inside this
// feature's total, rather than increasing the old routes' budget.
const customizationRawBytes =
  4_000 +
  customizationCodeAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) +
  Math.max(...customizationLocaleAssets.map((asset) => asset.rawBytes));
const customizationGzipBytes =
  1_500 +
  customizationCodeAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) +
  Math.max(...customizationLocaleAssets.map((asset) => asset.gzipBytes));
if (
  customizationRawBytes > budgets.customizationRawBytes ||
  customizationGzipBytes > budgets.customizationGzipBytes
)
  violations.push(
    "Workspace customization exceeds its 30 KB raw / 10 KB gzip feature budget.",
  );
const localUtilityAssets = codeAssets.filter((asset) =>
  /^local-utility-workbench-[^/]+\.js$/u.test(asset.fileName),
);
if (localUtilityAssets.length !== 1) {
  violations.push("Expected one lazy local utility workbench asset.");
}
const localUtilityRawBytes = localUtilityAssets.reduce(
  (sum, asset) => sum + asset.rawBytes,
  0,
);
const localUtilityGzipBytes = localUtilityAssets.reduce(
  (sum, asset) => sum + asset.gzipBytes,
  0,
);

const providerSetupAssets = codeAssets.filter((asset) =>
  /^provider-setup-notice-[^/]+\.js$/u.test(asset.fileName),
);
if (providerSetupAssets.length !== 1) {
  violations.push("Expected one lazy provider setup notice asset.");
}
const providerSetupRawBytes = providerSetupAssets.reduce(
  (sum, asset) => sum + asset.rawBytes,
  0,
);
const providerSetupGzipBytes = providerSetupAssets.reduce(
  (sum, asset) => sum + asset.gzipBytes,
  0,
);
if (
  providerSetupRawBytes > budgets.providerSetupRawBytes ||
  providerSetupGzipBytes > budgets.providerSetupGzipBytes
) {
  violations.push("Provider setup notice exceeds its lazy-asset budget.");
}
if (
  localUtilityRawBytes > budgets.localUtilityRawBytes ||
  localUtilityGzipBytes > budgets.localUtilityGzipBytes
) {
  violations.push("Local utility workbench exceeds its lazy-route budget.");
}
const budgetResumeAssets = codeAssets.filter((asset) =>
  /^budget-task-resume-[^/]+\.js$/u.test(asset.fileName),
);
if (budgetResumeAssets.length !== 1)
  violations.push("Expected one conditional budget resume recovery asset.");
// Existing passing 0.3.9 local build (0ee2e67): largest studio pack is
// 8557 raw / 2826 gzip bytes. Its studio sources match released c408141.
// Scope/root bindings and lazy loading remain in existing generated/route code;
// bound that integration to 2 KB raw / 900 bytes gzip within the feature cap.
const budgetResumeRawBytes =
  2_000 +
  budgetResumeAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) +
  Math.max(
    0,
    Math.max(...studioLocaleAssets.map((asset) => asset.rawBytes)) - 8_557,
  );
const budgetResumeGzipBytes =
  900 +
  budgetResumeAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) +
  Math.max(
    0,
    Math.max(...studioLocaleAssets.map((asset) => asset.gzipBytes)) - 2_826,
  );
if (
  budgetResumeRawBytes > budgets.budgetResumeRawBytes ||
  budgetResumeGzipBytes > budgets.budgetResumeGzipBytes
)
  violations.push(
    "Budget resume exceeds its recovery, selected-language and integration feature cap.",
  );
const completionReviewAssets = codeAssets.filter((asset) =>
  /^completion-review-(?:view|panel)-[^/]+\.js$/u.test(asset.fileName),
);
for (const name of ["view", "panel"]) {
  if (
    completionReviewAssets.filter((asset) =>
      asset.fileName.startsWith(`completion-review-${name}-`),
    ).length !== 1
  )
    violations.push(`Expected one bounded completion review ${name} asset.`);
}
// Passing PR #32 production log, job 110097988903: largest trace pack
// 7.45 KB raw / 2.73 KB gzip. Conservative lower baselines for rounded
// figures; the v0.3.8 parent has identical trace-pack sources.
const completionReviewRawBytes =
  // Bounded projection/disclosure wiring remains in the existing project route.
  500 +
  completionReviewAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) +
  Math.max(
    0,
    Math.max(...traceLocaleAssets.map((asset) => asset.rawBytes)) - 7_440,
  );
const completionReviewGzipBytes =
  250 +
  completionReviewAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) +
  Math.max(
    0,
    Math.max(...traceLocaleAssets.map((asset) => asset.gzipBytes)) - 2_720,
  );
if (
  completionReviewRawBytes > budgets.completionReviewRawBytes ||
  completionReviewGzipBytes > budgets.completionReviewGzipBytes
)
  violations.push(
    "Completion review basis exceeds its assets and selected-language growth budget.",
  );
// Fresh clean v0.3.9 (12ccba9) build with Node 24.19 and the pinned lockfile:
// gzip uses the same level 9 as this checker: entry 114976/33571,
// CSS 131244/20737, expert profile 26836/8210, controls 134035/41988,
// largest expert pack 9311/3141 bytes raw/gzip.
// Only these named integration surfaces receive the bounded feature allowance.
const keeperSurfaces = [
  {
    match: (name: string) => /^index-[^/]+\.js$/u.test(name),
    raw: 114_976,
    gzip: 33_571,
    keeperReleaseRaw: 118_907,
    keeperReleaseGzip: 35_468,
  },
  {
    match: (name: string) => /^index-[^/]+\.css$/u.test(name),
    raw: 131_244,
    gzip: 20_737,
    keeperReleaseRaw: 133_035,
    keeperReleaseGzip: 21_205,
  },
  {
    match: (name: string) =>
      /^detail-[^/]+\.js$/u.test(name) &&
      readFileSync(resolve(outputDirectory, name), "utf8").includes(
        "expert-detail-copy",
      ),
    raw: 26_836,
    gzip: 8_210,
    keeperReleaseRaw: 28_397,
    keeperReleaseGzip: 8_710,
  },
  {
    match: (name: string) => /^vendor-ui-[^/]+\.js$/u.test(name),
    raw: 134_035,
    gzip: 41_988,
    keeperReleaseRaw: 134_401,
    keeperReleaseGzip: 42_109,
  },
];
let keeperLiveRawBytes = Math.max(
  0,
  Math.max(...expertDetailLocaleAssets.map((asset) => asset.rawBytes)) - 9_311,
);
let keeperLiveGzipBytes = Math.max(
  0,
  Math.max(...expertDetailLocaleAssets.map((asset) => asset.gzipBytes)) - 3_141,
);
// Clean v0.3.10 source tree 329ee774 (main f9de129) supplies the second
// baseline above. Growth since that release in these same named surfaces is
// already charged to the Keeper cap, so it cannot also receive resume credit.
let sharedResumeRawBytes = 0;
let sharedResumeGzipBytes = 0;
for (const surface of keeperSurfaces) {
  const matches = codeAssets.filter((asset) => surface.match(asset.fileName));
  if (matches.length !== 1)
    throw new Error("Expected exactly one measured Keeper integration asset.");
  keeperLiveRawBytes += Math.max(0, matches[0].rawBytes - surface.raw);
  keeperLiveGzipBytes += Math.max(0, matches[0].gzipBytes - surface.gzip);
  sharedResumeRawBytes += Math.max(
    0,
    matches[0].rawBytes - surface.keeperReleaseRaw,
  );
  sharedResumeGzipBytes += Math.max(
    0,
    matches[0].gzipBytes - surface.keeperReleaseGzip,
  );
}
if (
  keeperLiveRawBytes > budgets.keeperLiveRawBytes ||
  keeperLiveGzipBytes > budgets.keeperLiveGzipBytes
)
  violations.push(
    "Living Keepers exceed their 10 KB raw / 4 KB gzip integration budget.",
  );
// Resume's fixed allowance also covers generated API/project-route wiring
// outside the Keeper surfaces. Remove only the measured overlap, bounded by
// that allowance, before applying either feature credit to global totals.
const budgetResumeGlobalRawBytes =
  budgetResumeRawBytes - Math.min(2_000, sharedResumeRawBytes);
const budgetResumeGlobalGzipBytes =
  budgetResumeGzipBytes - Math.min(900, sharedResumeGzipBytes);
if (
  totalCodeGzipBytes -
    budgetResumeGlobalGzipBytes -
    skillLibraryGzipBytes -
    customizationGzipBytes -
    localUtilityGzipBytes -
    providerSetupGzipBytes -
    budgets.providerSetupIntegrationGzipBytes -
    completionReviewGzipBytes -
    keeperLiveGzipBytes -
    firstTaskModelCheckGzipBytes >
  budgets.baseCodeGzipBytes
) {
  violations.push(
    `code excluding bounded new features exceeds the original 396 KB gzip budget`,
  );
}

if (
  totalCodeRawBytes -
    budgetResumeGlobalRawBytes -
    completionReviewRawBytes -
    keeperLiveRawBytes >
  budgets.totalCodeRawBytes
) {
  violations.push(
    `total raw code ${formatBytes(totalCodeRawBytes)} exceeds ${formatBytes(budgets.totalCodeRawBytes)}`,
  );
}

if (
  totalCodeGzipBytes -
    budgetResumeGlobalGzipBytes -
    completionReviewGzipBytes -
    keeperLiveGzipBytes >
  budgets.totalCodeGzipBytes
) {
  violations.push(
    `total gzip code ${formatBytes(totalCodeGzipBytes)} exceeds ${formatBytes(budgets.totalCodeGzipBytes)}`,
  );
}

if (allHomeLocaleRawBytes > budgets.allHomeLocaleRawBytes) {
  violations.push(
    `all home language packs raw ${formatBytes(allHomeLocaleRawBytes)} exceeds ${formatBytes(budgets.allHomeLocaleRawBytes)}`,
  );
}

if (allHomeLocaleGzipBytes > budgets.allHomeLocaleGzipBytes) {
  violations.push(
    `all home language packs gzip ${formatBytes(allHomeLocaleGzipBytes)} exceeds ${formatBytes(budgets.allHomeLocaleGzipBytes)}`,
  );
}

if (allProjectLocaleRawBytes > budgets.allProjectLocaleRawBytes) {
  violations.push(
    `all projects language packs raw ${formatBytes(allProjectLocaleRawBytes)} exceeds ${formatBytes(budgets.allProjectLocaleRawBytes)}`,
  );
}

if (allProjectLocaleGzipBytes > budgets.allProjectLocaleGzipBytes) {
  violations.push(
    `all projects language packs gzip ${formatBytes(allProjectLocaleGzipBytes)} exceeds ${formatBytes(budgets.allProjectLocaleGzipBytes)}`,
  );
}

if (allNewProjectLocaleRawBytes > budgets.allNewProjectLocaleRawBytes) {
  violations.push(
    `all new-project language packs raw ${formatBytes(allNewProjectLocaleRawBytes)} exceeds ${formatBytes(budgets.allNewProjectLocaleRawBytes)}`,
  );
}

if (allNewProjectLocaleGzipBytes > budgets.allNewProjectLocaleGzipBytes) {
  violations.push(
    `all new-project language packs gzip ${formatBytes(allNewProjectLocaleGzipBytes)} exceeds ${formatBytes(budgets.allNewProjectLocaleGzipBytes)}`,
  );
}

if (allEmergencyLocaleRawBytes > budgets.allEmergencyLocaleRawBytes) {
  violations.push(
    `all emergency language packs raw ${formatBytes(allEmergencyLocaleRawBytes)} exceeds ${formatBytes(budgets.allEmergencyLocaleRawBytes)}`,
  );
}

if (allEmergencyLocaleGzipBytes > budgets.allEmergencyLocaleGzipBytes) {
  violations.push(
    `all emergency language packs gzip ${formatBytes(allEmergencyLocaleGzipBytes)} exceeds ${formatBytes(budgets.allEmergencyLocaleGzipBytes)}`,
  );
}

for (const asset of codeAssets) {
  if (
    asset.fileName.endsWith(".js") &&
    asset.rawBytes > budgets.singleJavaScriptRawBytes
  ) {
    violations.push(
      `${asset.fileName} raw size ${formatBytes(asset.rawBytes)} exceeds ${formatBytes(budgets.singleJavaScriptRawBytes)}`,
    );
  }

  const limit = asset.fileName.endsWith(".css")
    ? budgets.singleCssGzipBytes
    : budgets.singleJavaScriptGzipBytes;
  if (asset.gzipBytes > limit) {
    violations.push(
      `${asset.fileName} gzip size ${formatBytes(asset.gzipBytes)} exceeds ${formatBytes(limit)}`,
    );
  }
}

if (totalMediaRawBytes > budgets.totalMediaRawBytes) {
  violations.push(
    `total media ${formatBytes(totalMediaRawBytes)} exceeds ${formatBytes(budgets.totalMediaRawBytes)}`,
  );
}

for (const asset of mediaAssets) {
  if (asset.rawBytes > budgets.singleMediaRawBytes) {
    violations.push(
      `${asset.fileName} size ${formatBytes(asset.rawBytes)} exceeds ${formatBytes(budgets.singleMediaRawBytes)}`,
    );
  }
}

if (
  // Seven-language saved-outcome review adds 3,608 raw / 1,453 gzip bytes.
  meetingTurnLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0) >
    29000 ||
  meetingTurnLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0) >
    12000
) {
  violations.push("Meeting turn locale assets exceed their budget.");
}

if (
  meetingLocaleAssets.reduce((sum, a) => sum + a.rawBytes, 0) > 50000 ||
  meetingLocaleAssets.reduce((sum, a) => sum + a.gzipBytes, 0) > 22000
)
  violations.push("Meeting language packs exceed their aggregate budget.");
if (
  operationsLocaleAssets.reduce((sum, a) => sum + a.rawBytes, 0) > 100000 ||
  operationsLocaleAssets.reduce((sum, a) => sum + a.gzipBytes, 0) > 36000
)
  violations.push("Operations language packs exceed 100 KB raw / 36 KB gzip.");
console.table(
  assets.map((asset) => ({
    asset: asset.fileName,
    raw: formatBytes(asset.rawBytes),
    gzip: formatBytes(asset.gzipBytes),
  })),
);
console.log(
  `Budget resume recovery, selected studio-pack growth and bounded route wiring: ${formatBytes(budgetResumeRawBytes)} raw / ${formatBytes(budgetResumeGzipBytes)} gzip (13 KB / 4.5 KB feature cap).`,
);
console.log(
  `Code with one language per localized surface: ${formatBytes(totalCodeRawBytes)} raw / ${formatBytes(totalCodeGzipBytes)} gzip. All home packs: ${formatBytes(allHomeLocaleRawBytes)} raw / ${formatBytes(allHomeLocaleGzipBytes)} gzip. All projects packs: ${formatBytes(allProjectLocaleRawBytes)} raw / ${formatBytes(allProjectLocaleGzipBytes)} gzip. All new-project packs: ${formatBytes(allNewProjectLocaleRawBytes)} raw / ${formatBytes(allNewProjectLocaleGzipBytes)} gzip. All emergency packs: ${formatBytes(allEmergencyLocaleRawBytes)} raw / ${formatBytes(allEmergencyLocaleGzipBytes)} gzip. Media total: ${formatBytes(totalMediaRawBytes)} raw.`,
);

console.log(
  `Completion review assets, selected trace-pack growth and bounded route wiring: ${formatBytes(completionReviewRawBytes)} raw / ${formatBytes(completionReviewGzipBytes)} gzip (10 KB / 4 KB feature cap).`,
);
console.log(
  `Living Keepers measured integration and selected-language growth: ${formatBytes(keeperLiveRawBytes)} raw / ${formatBytes(keeperLiveGzipBytes)} gzip (10 KB / 4 KB feature cap).`,
);
if (violations.length > 0) {
  throw new Error(
    `Bundle performance budget failed:\n- ${violations.join("\n- ")}`,
  );
}

console.log("Bundle performance budget passed.");
console.log(
  `All meeting language packs: ${formatBytes(meetingLocaleAssets.reduce((sum, a) => sum + a.rawBytes, 0))} raw / ${formatBytes(meetingLocaleAssets.reduce((sum, a) => sum + a.gzipBytes, 0))} gzip.`,
);
console.log(
  `All directory language packs: ${formatBytes(allDirectoryLocaleRawBytes)} raw / ${formatBytes(allDirectoryLocaleGzipBytes)} gzip.`,
);
console.log(
  `All sign-in language packs: ${formatBytes(allAuthLocaleRawBytes)} raw / ${formatBytes(allAuthLocaleGzipBytes)} gzip.`,
);

console.log(
  `All new-expert language packs: ${formatBytes(allNewAgentLocaleRawBytes)} raw / ${formatBytes(allNewAgentLocaleGzipBytes)} gzip.`,
);

console.log(
  `All dynamic shell language packs: ${formatBytes(allShellLocaleRawBytes)} raw / ${formatBytes(allShellLocaleGzipBytes)} gzip.`,
);

console.log(
  `All operations language packs: ${formatBytes(operationsLocaleAssets.reduce((s, a) => s + a.rawBytes, 0))} raw / ${formatBytes(operationsLocaleAssets.reduce((s, a) => s + a.gzipBytes, 0))} gzip.`,
);

console.log(
  `All operator recovery language packs: ${formatBytes(operatorLocaleAssets.reduce((sum, asset) => sum + asset.rawBytes, 0))} raw / ${formatBytes(operatorLocaleAssets.reduce((sum, asset) => sum + asset.gzipBytes, 0))} gzip.`,
);
