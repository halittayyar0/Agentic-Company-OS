import type { OperatorCopy } from "../operator-copy";
const copy: OperatorCopy = {
  check: "Check server record",
  checking: "Checking server record…",
  help: "Checking only reads this request’s record. It never repeats or cancels the action.",
  legacy:
    "This older local record has no server recovery ID. Review the effects before clearing it.",
  reserved: "The server recorded this request; dispatch is not yet confirmed.",
  dispatched: "Dispatch was recorded; the final outcome is not yet confirmed.",
  complete: "The server recorded completion.",
  unavailable:
    "The action completed, but its saved output is unavailable. Do not repeat it just to recover output.",
  not_dispatched: "The server recorded that this request was not dispatched.",
  unknown: "The action may have run. Its outcome remains unconfirmed.",
  missing:
    "No matching record was found. This does not prove that the action never ran.",
  error:
    "The server record could not be verified. Keep this warning and check again.",
  browser:
    "A saved browser record does not restore control. Review the current page before taking control again.",
  review: "Review local warning",
  reviewHelp:
    "Review the possible effects before clearing this tab’s warning. Clearing does not stop or repeat an action.",
  reviewCheck:
    "I checked the effects and understand that clearing only removes this local warning.",
  finish: "Clear local warning",
  cancel: "Cancel",
  changed:
    "The record changed or could not be saved. Close this dialog, check the current record and try again.",
};
export default copy;
