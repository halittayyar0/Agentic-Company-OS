import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetModelCatalogQueryKey,
  type ModelCatalog,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { useLocale } from "@/components/i18n/locale-provider";
import { recoveryCopy } from "@/lib/recovery-copy";

export function ConnectionModuleStatus({
  error,
  onClose,
}: {
  error: boolean;
  onClose?: () => void;
}) {
  const { locale, t } = useLocale();
  return (
    <div
      role={error ? "alert" : "status"}
      className="space-y-2 text-sm [overflow-wrap:anywhere]"
    >
      <p>{error ? recoveryCopy[locale].title : t("loadingScreen")}</p>
      {error ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => window.location.reload()}
        >
          {recoveryCopy[locale].reload}
        </Button>
      ) : null}
      {onClose ? (
        <Button
          type="button"
          variant="outline"
          className="min-h-11 ms-2"
          onClick={onClose}
        >
          {t("close")}
        </Button>
      ) : null}
    </div>
  );
}

/** Only a user click loads the connection dialog. A lost module download keeps
 * the composer mounted and offers explicit dismissal/reload. No job callback exists. */
export function ModelConnectionLauncher({
  children,
  onReady,
}: {
  children: ReactNode;
  onReady?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const client = useQueryClient();
  const module = useQuery({
    queryKey: ["guided-connection-module"],
    queryFn: () => import("./guided-model-connection"),
    enabled: open,
    staleTime: Infinity,
    retry: false,
  });
  const Content = module.data?.default;
  useEffect(() => {
    if (!open || Content) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        opener.current?.focus();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, Content]);
  const restore = () => {
    const data = client.getQueryData<ModelCatalog>(
      getGetModelCatalogQueryKey(),
    );
    if (
      onReady &&
      client.getQueryState(getGetModelCatalogQueryKey())?.status ===
        "success" &&
      data?.models.some(
        (model) =>
          model.supportsTools &&
          data.providers.some(
            (provider) => provider.id === model.provider && provider.available,
          ),
      )
    )
      onReady();
    else opener.current?.focus();
  };
  return (
    <>
      <Button
        ref={opener}
        type="button"
        variant="outline"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="min-h-11 h-auto"
      >
        {children}
      </Button>
      {open && Content ? (
        <Content onClose={() => setOpen(false)} restoreFocus={restore} />
      ) : open ? (
        <ConnectionModuleStatus
          error={module.isError}
          onClose={() => {
            setOpen(false);
            opener.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}
