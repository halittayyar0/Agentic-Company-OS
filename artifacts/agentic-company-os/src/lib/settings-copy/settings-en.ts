import type { SettingsCopy } from "../settings-copy";
const copy: SettingsCopy = {
  title: "Connections and settings",
  description:
    "Manage model access, language and the appearance of your workspace.",
  preferences: "Your preferences",
  appearance: "Appearance",
  light: "Light",
  dark: "Dark",
  system: "Follow device",
  appearanceHelp: "Appearance is saved in this browser.",
  providers: "Model providers",
  credentialHelp:
    "A configured key is not proof of a working connection. Save first, then explicitly test a model.",
  key: "New API key",
  sourceRuntime: "Saved key",
  sourceEnvironment: "Server environment key",
  sourceNone: "No key configured",
  save: "Save key",
  remove: "Remove saved key",
  removeHelp:
    "Remove the key stored by this application? A server environment key, if present, will become active. Running requests may still finish with the previous key.",
  storedLocal:
    "Keys are stored in a local server file, without application-level encryption. Protect the server account and backups.",
  storedDatabase:
    "Keys are encrypted in the shared database. Workers pick up changes asynchronously; this page does not confirm that every worker has applied them.",
  serverManaged: "Managed on the server",
  serverHelp:
    "Configure this provider on the host. This page does not change its server settings.",
  unavailable: "Not available in the current catalog",
  test: "Test model",
  testHelp:
    "This sends a short prompt to the selected provider and may incur a charge. Output is limited to 10 tokens; the server stops waiting after 20 seconds and does not retry automatically. A timeout does not prove the provider stopped processing.",
  confirmTest: "Send test request",
  cancel: "Cancel",
  saved:
    "The server confirmed the settings were saved. This does not verify model access or worker rollout.",
  changed:
    "Settings changed elsewhere. Refresh and review before trying again.",
  unconfirmed:
    "The save could not be confirmed. It may already have been applied. Refresh and review the server state before submitting again. Your draft remains only on this page.",
  refresh: "Refresh settings",
  busy: "Working…",
  draftHelp:
    "Draft keys are not saved in browser storage. Leaving or reloading this page clears them.",
  loading: "Loading provider settings…",
  loadError:
    "Provider settings could not be loaded. Key and connection status are unknown.",
  stale:
    "The last loaded settings are shown. Refresh successfully before making changes or sending a test.",
  rateLimited:
    "Too many requests. Wait a minute, then refresh before trying again.",
  testFailed:
    "The test could not be confirmed. The provider may have processed or charged for the request. No automatic retry was sent.",
  testPassed: "This model responded to the test.",
  chatOnlyProjectWarning: "Agent projects need a model with tool support.",
  chatTestOnly: "This reply confirms chat only, not agent task readiness.",
  toolTestNext:
    "This model is listed as tool-capable and replied. Check your project for its next attempt.",
  viewProjects: "View projects",
  testHistorical:
    "This is a result for the displayed settings revision, not continuous monitoring or a guarantee for other models.",
  testBlocked:
    "Tests are unavailable while the emergency stop is active or its status is unknown.",
  revision: "Settings revision",
  selectedModel: "Model to test",
  catalog: "Model catalog",
  catalogHelp:
    "Models and descriptions come from the server catalog. Availability, prices and limits can change; check the provider before use.",
  search: "Search models",
  tools: "Tools supported",
  chatOnly: "Chat only",
  economy: "Economy",
  standard: "Standard",
  premium: "Premium",
  reasoning: "Reasoning",
  freeIdentifier: "Free-tier identifier; check provider limits",
  defaultModel: "Default model",
  more: "Show more models",
  empty: "No models match this search.",
  source: "Original catalog description",
  runtime: "Server operation",
  browserHelp:
    "Browser visibility is controlled at server startup. This page neither reads nor changes the current mode.",
  hostHelp:
    "Host commands run with the service account’s operating-system permissions, without isolation or privilege elevation. Keep these features disabled unless the host is isolated and you understand the access granted.",
  hostSettings: "Host execution is disabled by default. Server configuration:",
  clear: "Clear search",
  removeTitle: "Remove this saved key?",
  notTested: "No test result in this visit",
  elapsed: "Response time (ms)",
  currentChanged: "This result belongs to an older settings revision.",
  noDescription: "No description supplied.",
};
export default copy;
