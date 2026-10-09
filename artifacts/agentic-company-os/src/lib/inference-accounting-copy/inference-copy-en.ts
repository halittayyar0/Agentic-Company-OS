import type { InferenceAccountingCopy } from "../inference-accounting-copy";
export default {
  title: "Model usage records",
  clear: "No unresolved usage",
  pending: "Response window open",
  recovery_required: "Usage needs verification",
  pendingHelp:
    "A response may still arrive. This status does not confirm that the agent is running.",
  recoveryHelp:
    "Usage could not be verified. Further model requests in this scope stay paused. Keep the request ID for diagnosis. Checking status does not resend the request.",
  clearHelp:
    "No unresolved usage record is blocking this scope. This does not mean the task succeeded or grant permission to run it.",
  inspect: "Check saved records",
  error:
    "Current status cannot be verified. Previously shown records are kept.",
  observed: "Last observed",
  request: "Request ID",
  tokens: "tokens",
  lowerBound: "Reported minimum",
  complete: "Reported usage",
  unknownUsage: "Usage unknown",
  unknownCost: "Cost not reported",
  more: "Only the latest 20 records are shown; unresolved records appear first.",
  states: {
    reserved: "Prepared; not dispatched",
    dispatched: "Dispatched; awaiting accounting",
    uncertain: "Usage unconfirmed",
    accounted: "Usage recorded",
    not_dispatched: "Not dispatched",
  },
} satisfies InferenceAccountingCopy;
