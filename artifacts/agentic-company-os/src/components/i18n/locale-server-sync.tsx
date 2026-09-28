import { useEffect } from "react";
import { useLocale } from "./locale-provider";
import { controlPlaneFetch } from "@/lib/auth";

// Effect cleanup cannot undo an already dispatched preference write. Share
// ordering across effect restarts and component remounts within this page.
let localeWrites: Promise<void> = Promise.resolve();

export function LocaleServerSync() {
  const { locale, setSyncStatus, syncRevision } = useLocale();

  useEffect(() => {
    let active = true;
    setSyncStatus("saving");
    localeWrites = localeWrites
      .then(async () => {
        if (!active) return;
        const result = await controlPlaneFetch<{ locale: string }>(
          "/api/settings/locale",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ locale }),
          },
        );
        if (active) setSyncStatus(result.locale === locale ? "saved" : "error");
      })
      .catch(() => {
        if (active) setSyncStatus("error");
      });
    return () => {
      active = false;
    };
  }, [locale, setSyncStatus, syncRevision]);

  return null;
}
