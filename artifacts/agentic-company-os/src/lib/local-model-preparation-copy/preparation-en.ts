import type { ModelPreparationCopy } from "../local-model-preparation-copy";
export default {
  pendingHint: "Existing jobs waiting for this model may continue.",
  title: "Get a local model",
  description: "Download a small starter model to your saved Ollama server.",
  download: "Download model",
  stop: "Stop download",
  checking: "Checking the downloaded model",
  returnToJob: "Return to my job",
  available: "A local model is available",
  preparing: "Preparing the download",
  downloading: "Downloading model files",
  stopping: "Stopping this download request",
  interrupted:
    "Download interrupted. Check the model before trying again. Partial files may remain on the server.",
  failed:
    "The download could not be verified. Check the server before trying again.",
  unknown:
    "The download acknowledgement is unavailable. Check its status or stop this request before retrying.",
  check: "Check download",
  install: "Install or update Ollama",
  where:
    "Choose the operating system of the computer or server that will run the model.",
  storage:
    "About 2 GB of model files, plus free space for temporary files. Uses the connected computer or server's network and disk, not your phone's storage.",
  saveFirst: "Save and check the server address before downloading.",
  continues:
    "You can close this window while downloading. Stop affects this request; other clients may continue downloading.",
  reset:
    "The server restarted part of the transfer. The observed byte count has decreased.",
  unavailable:
    "Ollama is not reachable. Install or start it on the computer or server that will run the model, then check again.",
  update:
    "This starter model needs Ollama 0.40.3 or later. Update the connected server, then check again.",
  changed:
    "The saved connection changed. Check the current server before downloading again.",
  readyHint:
    "Return to your draft and choose when to start. Existing jobs waiting for this model may continue.",
  bytes: "Observed model data",
} satisfies ModelPreparationCopy;
