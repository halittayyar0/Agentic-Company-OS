import { ModelAdmissionDeniedError } from "./model-fallback";
export class InferenceAccountingError extends ModelAdmissionDeniedError {
  readonly code = "INFERENCE_ACCOUNTING_REQUIRED";
  constructor(
    readonly reason: "unsettled" | "storage" | "conflict" | "unknown",
    readonly attemptId: string | null = null,
    readonly accountingStatus:
      "pending" | "recovery_required" = "recovery_required",
  ) {
    super(
      "Durable usage accounting requires recovery before further inference.",
    );
    this.name = "InferenceAccountingError";
  }
}
