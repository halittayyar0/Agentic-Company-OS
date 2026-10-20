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
    "Pauses agent chat, tasks, tools, and approved actions. It does not undo external effects.",
  resumeDescription:
    "Resumes the scheduler, agent chat, tools, and approved actions. Review workspace safety first.",
  reason: "Reason for stopping",
  reasonPlaceholder: "Reviewing an unexpected browser action",
  reasonHelp: "3+ characters; saved in the audit log.",
  actionError: "The action could not be completed. Try again.",
  cancel: "Cancel",
  applying: "Applying…",
  confirmResume: "Yes, resume work",
  confirmStop: "Yes, stop all work",
  safetyUnknown:
    "Safety stop status cannot be verified; new risky actions are disabled.",
  retry: "Check again",
  stopActive: "Emergency stop is active.",
  nativeUpgradePaused: "Update verified. Review before resuming.",
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
