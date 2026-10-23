import { useQuery } from "@tanstack/react-query";
import { useLocale } from "@/components/i18n/locale-provider";
import { LanguagePackStatus } from "@/components/i18n/language-pack-status";
import { loadModelPreparationCopy } from "@/lib/local-model-preparation-copy";
import { recoveryCopy } from "@/lib/recovery-copy";
import LocalModelPreparation, {
  type ModelPreparationProps,
} from "./local-model-preparation";

export default function LocalModelPreparationSlot(
  props: ModelPreparationProps,
) {
  const { locale } = useLocale();
  const copy = useQuery({
    queryKey: ["local-model-preparation-copy", locale],
    queryFn: () => loadModelPreparationCopy(locale),
    retry: false,
    staleTime: Infinity,
  });
  return copy.data ? (
    <LocalModelPreparation {...props} c={copy.data} />
  ) : (
    <LanguagePackStatus
      error={copy.isError}
      buttonClassName="min-h-11 md:min-h-11"
      retryLabel={recoveryCopy[locale].reload}
    />
  );
}
