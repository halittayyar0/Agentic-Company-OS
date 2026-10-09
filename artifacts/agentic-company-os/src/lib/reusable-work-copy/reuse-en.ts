import type { ReusableWorkCopy } from "../reusable-work-copy";

export default {
  incomingTitle: "Choose the brief to use",
  incomingHelp:
    "Your current draft stays until you choose to replace it with the incoming brief.",
  keepCurrent: "Keep current draft",
  useIncoming: "Use incoming brief",
  choiceError:
    "This tab could not retain your choice. Your editable text is still here. Try the choice again before starting.",
  preparationOnly:
    "Preparing this draft starts no work and grants no tool access.",
} satisfies ReusableWorkCopy;
