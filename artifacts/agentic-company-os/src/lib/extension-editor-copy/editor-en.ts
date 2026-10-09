import type { ExtensionEditorCopy } from "../extension-editor-copy";
export default {
  storageError:
    "This tab could not retain or clear the draft or save record. Your editable text stays here; a reload may lose unsaved changes. Saving starts only after the request can be retained.",
  pendingTitle: "Check this save before saving again",
  uncertain:
    "The save response is unconfirmed. Keep the same guide ID and submitted version; nothing is retried automatically.",
  check: "Check saved contents",
  retry: "Retry submitted save",
  continue: "Continue editing",
  matching:
    "The current stored ID, contents, availability and revision match your submission. This is a contents check, not a command receipt.",
  missing:
    "This read found no new saved version. The first request may still finish. Retry sends the same ID, contents and expected revision.",
  changed:
    "The stored guide differs from this submission. Review its contents before continuing; no save is retried.",
  invalid:
    "Could not validate the saved contents. Your submitted record stays here. Check again when the connection is available.",
  validation:
    "Correct the ID and required fields before saving: title up to 120 characters, description 2,000, instructions or code 8,000, and the JSON package 16,000. Tool defaults must be a JSON object. Text is never shortened automatically.",
  availability: "Available to agents after Save",
  incomingHelp:
    "You already have an editable draft. Keep it or explicitly replace it with the selected guide or import.",
  keep: "Keep current editor draft",
  use: "Use selected guide",
  reviewCurrent: "Keep my edits with the stored revision",
  storedVersion: "Currently stored guide",
  storedAvailability: "Available in stored version",
  reviewHelp:
    "Review the stored text below. Continuing keeps your editable text and uses this observed revision for a later explicit Save. It grants no new permission.",
} satisfies ExtensionEditorCopy;
