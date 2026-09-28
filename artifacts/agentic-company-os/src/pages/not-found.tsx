import { Link } from "wouter";
import { Compass } from "lucide-react";
import { Panel } from "@/components/fx";
import { useLocale } from "@/components/i18n/locale-provider";

export default function NotFound() {
  const { t } = useLocale();
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <Panel sheen className="max-w-md p-10 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <Compass size={24} />
        </div>
        <h1 className="text-2xl font-extrabold tracking-tight">
          {t("pageNotFound")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("pageNotFoundDescription")}
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90"
        >
          {t("backHome")}
        </Link>
      </Panel>
    </div>
  );
}
