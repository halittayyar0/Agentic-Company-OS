import { createRoot } from "react-dom/client";

import App from "./App";
import { ErrorBoundary, reportCaughtError } from "@/components/error-boundary";
import { loadSavedTheme } from "@/lib/theme";

import "./index.css";

loadSavedTheme();

createRoot(document.getElementById("root")!, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    reportCaughtError(error, errorInfo.componentStack);
  },
}).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
