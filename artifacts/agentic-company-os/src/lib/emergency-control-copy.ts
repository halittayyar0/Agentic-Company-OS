import type { Locale } from "@/lib/i18n";

export const fallbackEmergencyControlCopy = {
  checking: "Checking emergency stop status",
  retryLabel: "Check emergency stop status again",
  unavailable: "Emergency stop status could not be loaded",
  stop: "Emergency stop",
  resume: "Resume",
  resumeLabel: "Resume work",
  stopTitle: "Stop all agent work",
  resumeTitle: "Resume agent work",
  stopDescription:
    "This safety stop pauses agent chat, task execution, agent tools, and approved actions. It does not undo external effects already made.",
  resumeDescription:
    "The task scheduler, agent chat, tools, and approved actions may run again. Confirm that the workspace is safe before resuming.",
  reason: "Reason for stopping",
  reasonPlaceholder: "For example, reviewing an unexpected browser action",
  reasonHelp: "At least 3 characters; saved in the audit log.",
  actionError: "The action could not be completed. Try again.",
  cancel: "Cancel",
  applying: "Applying…",
  confirmResume: "Yes, resume work",
  confirmStop: "Yes, stop all work",
  safetyUnknown:
    "Safety stop status cannot be verified; new risky actions are disabled.",
  retry: "Check again",
  stopActive: "Emergency stop is active.",
};

export type EmergencyControlCopy = typeof fallbackEmergencyControlCopy;

export const loadEmergencyControlCopy: Record<
  Locale,
  () => Promise<EmergencyControlCopy>
> = {
  en: () => Promise.resolve(fallbackEmergencyControlCopy),
  tr: () =>
    import("./emergency-control-copy/emergency-tr").then(
      (module) => module.default,
    ),
  de: () =>
    import("./emergency-control-copy/emergency-de").then(
      (module) => module.default,
    ),
  ru: () =>
    import("./emergency-control-copy/emergency-ru").then(
      (module) => module.default,
    ),
  "zh-CN": () =>
    import("./emergency-control-copy/emergency-zh-CN").then(
      (module) => module.default,
    ),
  "zh-TW": () =>
    import("./emergency-control-copy/emergency-zh-TW").then(
      (module) => module.default,
    ),
  ar: () =>
    import("./emergency-control-copy/emergency-ar").then(
      (module) => module.default,
    ),
};
