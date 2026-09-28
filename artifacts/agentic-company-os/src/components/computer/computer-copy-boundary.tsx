import { LanguagePackStatus } from "../i18n/language-pack-status";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@/lib/i18n";
import { loadComputerCopy, type ComputerCopy } from "@/lib/computer-copy";

export function ComputerCopyBoundary({
  children,
}: {
  children: (copy: ComputerCopy, locale: Locale) => ReactNode;
}) {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["computer-copy", locale],
    queryFn: () => loadComputerCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        className="rounded-xl border bg-card p-5"
        buttonClassName="mt-3"
      />
    );
  return children(copy.data, locale);
}
