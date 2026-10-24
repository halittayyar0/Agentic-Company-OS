import { useQuery } from "@tanstack/react-query";
import { useLocale } from "../i18n/locale-provider";
import { LanguagePackStatus } from "../i18n/language-pack-status";
import { loadTaskResultReviewCopy } from "../../lib/task-result-review-copy";
export default function OperatorResultProvenance() {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["task-result-review-copy", locale],
    queryFn: () => loadTaskResultReviewCopy(locale),
    staleTime: Infinity,
    retry: false,
  });
  if (!copy.data)
    return (
      <LanguagePackStatus
        error={copy.isError}
        onRetry={() => window.location.reload()}
      />
    );
  return (
    <div className="mt-3 border-s-2 border-attention ps-3 text-sm leading-relaxed">
      <p className="font-semibold">{copy.data.provenance}</p>
      <p className="mt-1 text-muted-foreground">{copy.data.provenanceHelp}</p>
    </div>
  );
}
