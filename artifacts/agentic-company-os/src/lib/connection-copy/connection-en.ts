import type { ConnectionCopy } from "../connection-copy";
export default {
  apiProviders: "API provider",
  signedOut: "This account is signed out. Sign in again before using it.",
  signInAgain: "Sign in again",
  clearAttempt: "Clear ended sign-in",
  description:
    "Keep your job here while you connect. Existing jobs waiting for a provider may continue after a connection is saved.",
  local: "Local model",
  localHint: "Use Ollama on this computer or a private server.",
  allowCloud: "Allow cloud models for this server",
  cloudUsage:
    "Cloud models send prompts to Ollama cloud and use that account's applicable usage or charges. Saving does not send a model request.",
  localLocation: "Runs locally",
  cloudLocation: "Uses Ollama cloud",
  unknownLocation: "Location unverified",
  localRequirement:
    "Local enforcement requires Ollama 0.18.0 or later. Update this server, then check the connection again.",
  localVerified:
    "Local models use this server's hardware. Tool support is shown separately.",
  cloudOff: "Cloud permission is off for the saved server.",
  cloudOn: "Cloud permission is on for the saved server.",
  chatgptHint:
    "Use an eligible ChatGPT plan; permission and quota still apply.",
  api: "API key",
  apiHint:
    "Connect OpenAI or OpenRouter with your own key. Provider charges may apply.",
  back: "All connection options",
  endpoint: "Ollama address",
  endpointHint:
    "This address is reached by the backend, not your phone. Use a private HTTP(S) endpoint.",
  save: "Save connection",
  restore: "Use installation default",
  restoreHint:
    "Remove the saved override. An environment address remains active.",
  key: "API key",
  keyHint:
    "The key stays in memory until saved securely on the backend. It is not kept in browser storage.",
  saved:
    "Connection saved. Discovered models have not been tested with an inference request.",
  unconfirmed:
    "The save could not be confirmed. Check the current connection before saving again.",
  invalid: "Check the address or key and try again.",
  changed:
    "The connection changed. Read its current state before saving again.",
  discovered: "Discovered models",
  none: "No model with tools is available yet. Check the provider; for Ollama, add a model and check again.",
  tools: "Tools available",
  chatOnly: "Chat only",
  advanced: "Advanced settings and explicit model test",
  done: "Return to my job",
  accounts: "Saved accounts",
  noAccounts: "No saved account yet.",
  selected: "Selected",
  select: "Select this account",
  identityOnly:
    "Signed in for identity only. Grant plan permission to use models.",
  planReady:
    "Plan permission granted. Availability and quota are checked when you run a job.",
  paused: "Plan usage is paused. Review the limit before retrying a job.",
  signIn: "Continue with ChatGPT",
  sameComputer: "The browser and backend run on this same computer.",
  officialLink: "Open official sign-in",
  pending:
    "Sign-in is waiting. Finish in the official browser page, then check status.",
  review:
    "Review this account before saving it. Saving does not select it or start your job.",
  confirm: "Save reviewed account",
  cancel: "Cancel sign-in",
  connected: "Account saved. Select it explicitly to use it.",
  ended: "This sign-in ended. Your previous account selection is unchanged.",
  handoffTitle: "Phone, server or container",
  handoffText:
    "A remote browser cannot reach the backend’s private callback. Sign in on your own computer and transfer the protected registration to the server using the guide. Never paste credentials here.",
  handoffGuide: "Open secure handoff guide",
  enablePlan: "Grant plan permission",
  refresh: "Check current connection",
  unknown:
    "The result is unconfirmed. Read the current state; do not repeat the action blindly.",
} satisfies ConnectionCopy;
