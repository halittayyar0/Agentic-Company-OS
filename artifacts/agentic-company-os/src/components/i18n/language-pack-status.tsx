import React from "react";
import { useLocale } from "./locale-provider";
import { Button } from "../ui/button";
import { setupMessages } from "../../lib/i18n";

/** Shared presentation only: each caller retains its cache, retry policy and
 * any mounted draft while a language download is pending or unavailable. */
export function LanguagePackStatus({
  error,
  as: Container = "section",
  className,
  buttonClassName,
  onRetry = () => window.location.reload(),
  retryLabel,
}: {
  error: boolean;
  as?: "section" | "div";
  className?: string;
  buttonClassName?: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const { locale, t } = useLocale();
  return (
    <Container className={className} role={error ? "alert" : "status"}>
      <p>
        {error ? setupMessages[locale].languageFileError : t("loadingScreen")}
      </p>
      {error && (
        <Button className={buttonClassName} onClick={onRetry}>
          {retryLabel ?? t("checkAgain")}
        </Button>
      )}
    </Container>
  );
}
