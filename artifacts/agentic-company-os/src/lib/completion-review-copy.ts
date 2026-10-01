import type {
  ReviewReceiptState,
  ReviewTaskState,
} from "./completion-review-view";
export interface CompletionReviewCopy {
  title: string;
  help: string;
  loadError: string;
  cycle: string;
  operations: string;
  children: string;
  counts: string;
  countsHelp: string;
  receipts: string;
  childSample: string;
  limited: string;
  empty: string;
  taskStep: string;
  approvedAction: string;
  resultFlag: string;
  confirmedApplied: string;
  confirmedNotApplied: string;
  states: Record<ReviewReceiptState | ReviewTaskState, string>;
}
