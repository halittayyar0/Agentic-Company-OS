import {
  getGetModelCatalogQueryKey,
  useGetModelCatalog,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle, PlugZap } from "lucide-react";
import { useLocale } from "@/components/i18n/locale-provider";
import { Button } from "@/components/ui/button";

export default function ProviderSetupNotice({
  onReady,
}: {
  onReady: () => void;
}) {
  const { t } = useLocale();
  const [retrying, setRetrying] = useState(false);
  const retryRef = useRef<HTMLButtonElement>(null);
  const setupRef = useRef<HTMLAnchorElement>(null);
  const restoreFocus = useRef(false);
  const catalog = useGetModelCatalog({
    query: {
      queryKey: getGetModelCatalogQueryKey(),
      staleTime: 30_000,
      retry: false,
    },
  });
  const needsRecovery = catalog.isError || retrying;
  const data = catalog.data;
  const hasUsableModel = data?.models.some(
    (model) =>
      model.supportsTools &&
      data.providers.some(
        (provider) => provider.id === model.provider && provider.available,
      ),
  );
  useLayoutEffect(() => {
    if (retrying || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (
      document.activeElement !== document.body &&
      document.activeElement !== retryRef.current
    )
      return;
    if (catalog.isError) retryRef.current?.focus();
    else if (hasUsableModel) onReady();
    else setupRef.current?.focus();
  }, [retrying, catalog.isError, hasUsableModel, onReady]);
  const checkAgain = async () => {
    if (retrying || catalog.isFetching) return;
    restoreFocus.current = document.activeElement === retryRef.current;
    const respectFocus = (event: FocusEvent) => {
      if (event.target !== document.body && event.target !== retryRef.current)
        restoreFocus.current = false;
    };
    document.addEventListener("focusin", respectFocus);
    setRetrying(true);
    try {
      await catalog.refetch();
    } finally {
      document.removeEventListener("focusin", respectFocus);
      setRetrying(false);
    }
  };
  if (!needsRecovery && hasUsableModel) return null;

  return (
    <div
      role={needsRecovery ? "alert" : "status"}
      className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control border border-attention/30 bg-attention/5 px-4 py-3 text-sm text-attention-foreground"
    >
      {!data && !needsRecovery ? (
        <LoaderCircle
          className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
          aria-hidden
        />
      ) : (
        <PlugZap className="size-4 shrink-0" aria-hidden />
      )}
      <span className="min-w-0 flex-1 basis-[calc(100%_-_1.75rem)] [overflow-wrap:anywhere] sm:basis-auto">
        {t(
          needsRecovery
            ? "providerSetupError"
            : !data
              ? "providerSetupChecking"
              : "providerSetupMessage",
        )}
      </span>
      {needsRecovery ? (
        <Button
          ref={retryRef}
          type="button"
          variant="outline"
          disabled={retrying || catalog.isFetching}
          aria-busy={retrying || catalog.isFetching}
          onClick={() => void checkAgain()}
          className="min-h-11 h-auto max-w-full whitespace-normal py-2 [overflow-wrap:anywhere]"
        >
          {retrying || catalog.isFetching
            ? t("providerSetupChecking")
            : t("checkAgain")}
        </Button>
      ) : null}
      {needsRecovery || data ? (
        <Link
          ref={setupRef}
          href="/settings"
          className="inline-flex min-h-11 min-w-0 max-w-full items-center font-semibold underline underline-offset-4 [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {t(needsRecovery ? "connections" : "providerSetupAction")}
        </Link>
      ) : null}
    </div>
  );
}
