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
  savedBrief: "Saved brief",
  useBrief: "Use brief again",
  prepareGuide: "Prepare personal guide",
  sourceHelp:
    "Prepare editable text from this source snapshot. Review it for your next task; starting work is a separate action.",
  guideSource: "Saved brief from local project #{id}. Review before reuse.",
  preparedGuide: "Review the guide from this saved brief",
  guideTitleHelp:
    "The source title is kept exactly. Edit titles longer than 120 characters before Save. Review the instructions and availability choice.",
  prepareProject: "Prepare a project",
  disabledGuideHelp:
    "This guide is disabled for agent discovery. Preparing its text keeps that setting.",
  runtimeHelp:
    "New work uses this installation's selected connection, access policy and token/cost limits. Review Settings before Start.",
  waitingGuide:
    "Finish checking the earlier save before reviewing this incoming guide.",
} satisfies ReusableWorkCopy;
