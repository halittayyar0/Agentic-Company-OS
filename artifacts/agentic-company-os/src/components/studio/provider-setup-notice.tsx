import {
  getGetModelCatalogQueryKey,
  useGetModelCatalog,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { PlugZap } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";

export default function ProviderSetupNotice() {
  const { t } = useLocale();
  const catalog = useGetModelCatalog({
    query: {
      queryKey: getGetModelCatalogQueryKey(),
      staleTime: 30_000,
      retry: false,
    },
  });
  if (
    !catalog.data ||
    catalog.data.models.some(
      (model) =>
        model.supportsTools &&
        catalog.data.providers.some(
          (provider) => provider.id === model.provider && provider.available,
        ),
    )
  )
    return null;

  return (
    <div
      role="status"
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-attention/30 bg-attention/5 px-4 py-3 text-sm text-attention-foreground"
    >
      <PlugZap className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">{t("providerSetupMessage")}</span>
      <Link
        href="/settings"
        className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        {t("providerSetupAction")}
      </Link>
    </div>
  );
}
