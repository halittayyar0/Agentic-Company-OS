import { LanguagePackStatus } from "../i18n/language-pack-status";
import { OperationsCopyProvider } from "./operations-copy-context";
import { type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "../i18n/locale-provider";
import { loadOperationsCopy } from "../../lib/operations-copy";

export function OperationsCopyBoundary({ children }: { children: ReactNode }) {
  const { locale } = useLocale();
  const query = useQuery({
    queryKey: ["operations-copy", locale],
    queryFn: () => loadOperationsCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!query.data)
    return (
      <LanguagePackStatus
        error={query.isError}
        className="rounded-xl border bg-card p-5"
        buttonClassName="mt-3"
      />
    );
  return (
    <OperationsCopyProvider copy={query.data} locale={locale}>
      {children}
    </OperationsCopyProvider>
  );
}
