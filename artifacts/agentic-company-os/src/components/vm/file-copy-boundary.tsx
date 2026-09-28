import { LanguagePackStatus } from "../i18n/language-pack-status";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@/lib/i18n";
import { loadFileCopy, type FileCopy } from "@/lib/file-copy";

export function FileCopyBoundary({
  children,
}: {
  children: (copy: FileCopy, locale: Locale) => ReactNode;
}) {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["file-copy", locale],
    queryFn: () => loadFileCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        className="rounded-xl border bg-card p-5"
        buttonClassName="mt-3 min-h-11 md:min-h-11"
      />
    );
  return children(copy.data, locale);
}
