import type { BrowserCopy } from "../browser-copy";
const copy: BrowserCopy = {
  zoomIn: "Actual image size",
  zoomOut: "Fit image",
  title: "Browser",
  help: "Inspect the agent’s browser, then take control to interact. Updates are periodic screenshots.",
  address: "Website address",
  go: "Open address",
  addressInvalid:
    "Enter an HTTP or HTTPS address without embedded credentials.",
  take: "Take control",
  release: "Return control",
  ownerAgent: "Agent controls the browser",
  ownerOperator: "You control the browser",
  ownerOther:
    "Operator control is active; your control is unverified in this tab.",
  agentBusy: "Wait for the agent’s current browser action to finish.",
  blocked: "Browser changes are paused until the safety controls allow them.",
  loading: "Checking the browser…",
  refresh: "Refresh image",
  pause: "Pause images",
  resume: "Resume images",
  polling: "Images update periodically",
  paused: "Images paused · input disabled",
  syncLost:
    "The latest image could not be verified. Input is disabled; the last image is retained.",
  received: "Image received",
  empty: "No browser session. Take control, then open an address.",
  imageLabel: "Browser image",
  frameHelp:
    "Click the image to select a target. Tab leaves this image; Escape focuses Take control. Use the controls below for remote keys. The image does not expose the remote page to screen readers.",
  textLabel: "Text for the selected remote field",
  textHelp:
    "Select a field in the image, compose text here, then send it. Enter adds a line break. Passwords are visible here; clear this draft when finished.",
  textInvalid:
    "Enter 1–4096 UTF-16 code units, without NUL or incomplete Unicode characters.",
  send: "Send text",
  busy: "Waiting for the browser’s response…",
  sent: "Browser action acknowledged.",
  unknown: "The action’s outcome is unknown.",
  unknownHelp:
    "No automatic replay. Refresh the image and inspect the remote page before continuing. This local marker contains no text or address and is not a server receipt.",
  review: "Review the current image",
  reviewCheck:
    "I inspected the current page and understand that the previous action may have happened.",
  reviewDone: "Finish review",
  reviewRequired: "Review the uncertain action before sending another.",
  error:
    "The request was rejected. Refresh the image and check who controls the browser.",
  close: "Close browser",
  closeTitle: "Close this browser session?",
  closeHelp:
    "The remote page and its unsaved data will be closed. This requires your current control lease.",
  cancel: "Cancel",
  confirm: "Close session",
  fullscreen: "Full screen",
  exitFullscreen: "Exit full screen",
  fullscreenError: "Full screen is unavailable in this browser.",
  back: "Back",
  forward: "Forward",
  reload: "Reload page",
  tab: "Next field",
  shiftTab: "Previous field",
  enter: "Enter",
  backspace: "Backspace",
  escape: "Escape",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  scrollUp: "Scroll up",
  scrollDown: "Scroll down",
  storageError:
    "Local recovery storage is unavailable. New actions are blocked until it works.",
  retryStorage: "Retry local storage",
  damaged:
    "The local recovery marker is unreadable. Inspect the current page before clearing it.",
  draftsHint:
    "Draft text and addresses stay in this tab’s memory only. Copy them before reloading or closing the tab.",
  windowVisible: "Window visible on host",
  windowHidden: "Browser runs in background",
};
copy.unknownHelp += " The action may still finish later.";
export default copy;
