import { LanguagePackStatus } from "../i18n/language-pack-status";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/components/i18n/locale-provider";
import type { Locale } from "@/lib/i18n";
import { loadTraceCopy, type TraceCopy } from "@/lib/trace-copy";

export function TraceCopyBoundary({
  children,
}: {
  children: (c: TraceCopy) => ReactNode;
}) {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["trace-copy", locale],
    queryFn: () => loadTraceCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        as="div"
        className="p-5"
        buttonClassName="mt-3 min-h-11"
      />
    );
  return children(copy.data);
}

export function TraceTime({
  value,
  locale,
  unknown,
}: {
  value: string | null;
  locale: Locale;
  unknown: string;
}) {
  if (!value || !Number.isFinite(Date.parse(value)))
    return <span>{unknown}</span>;
  return (
    <time dateTime={value} className="break-words">
      {new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeStyle: "medium",
        timeZone: "Europe/Istanbul",
      }).format(new Date(value))}{" "}
      <bdi>Europe/Istanbul</bdi>
    </time>
  );
}
