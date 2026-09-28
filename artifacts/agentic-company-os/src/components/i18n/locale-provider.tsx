import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import {
  directionForLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  previewUiMessages,
  cachedShellMessages,
  loadShellMessages,
  setupMessages,
  type Locale,
  type MessageKey,
} from "../../lib/i18n";

type LocaleContextValue = {
  locale: Locale;
  selected: boolean;
  syncStatus: "pending" | "saving" | "saved" | "error";
  setSyncStatus: (status: "saving" | "saved" | "error") => void;
  syncRevision: number;
  retrySync: () => void;
  setLocale: (locale: Locale) => void;
  changingLocale: boolean;
  t: (key: MessageKey) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

function savedLocale(): Locale | null {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : null;
  } catch {
    return null;
  }
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(savedLocale);
  const [locale, updateLocale] = useState<Locale>(initial ?? "tr");
  const [, refreshMessages] = useState(0);
  const [failedLocale, setFailedLocale] = useState<Locale | null>(null);
  const copy = cachedShellMessages(locale);
  useEffect(() => {
    if (cachedShellMessages(locale)) return;
    let active = true;
    setFailedLocale(null);
    void loadShellMessages(locale).then(
      () => {
        if (active) refreshMessages((value) => value + 1);
      },
      () => {
        if (active) setFailedLocale(locale);
      },
    );
    return () => {
      active = false;
    };
  }, [locale]);
  const [selected, setSelected] = useState(initial !== null);
  const [syncStatus, setSyncStatus] =
    useState<LocaleContextValue["syncStatus"]>("pending");
  const [syncRevision, setSyncRevision] = useState(0);
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [switchFailure, setSwitchFailure] = useState<Locale | null>(null);
  const switchRevision = useRef(0);
  const chooseLocale = useCallback((nextLocale: Locale) => {
    const revision = ++switchRevision.current;
    setSwitchFailure(null);
    const commit = () => {
      if (revision !== switchRevision.current) return;
      setPendingLocale(null);
      updateLocale(nextLocale);
      setSelected(true);
      setSyncStatus("pending");
      try {
        window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
      } catch {
        /* The choice remains available in this tab. */
      }
    };
    if (cachedShellMessages(nextLocale)) {
      commit();
      return;
    }
    // Keep the current tree mounted until the next shell is ready. A language
    // download must never destroy an operator's unsaved form.
    setPendingLocale(nextLocale);
    void loadShellMessages(nextLocale).then(commit, () => {
      if (revision !== switchRevision.current) return;
      setPendingLocale(null);
      setSwitchFailure(nextLocale);
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = directionForLocale(locale);
  }, [locale]);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      selected,
      syncStatus,
      setSyncStatus,
      syncRevision,
      retrySync() {
        setSyncRevision((revision) => revision + 1);
      },
      setLocale: chooseLocale,
      changingLocale: pendingLocale !== null,
      t(key) {
        // Children mount only after their selected shell has loaded.
        if (!copy) throw new Error("Interface language is not ready");
        return copy[key];
      },
    }),
    [
      locale,
      selected,
      syncStatus,
      syncRevision,
      copy,
      chooseLocale,
      pendingLocale,
    ],
  );

  if (!copy) {
    const startup = setupMessages[locale];
    return (
      <main
        lang={locale}
        dir={directionForLocale(locale)}
        className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"
      >
        <div
          role={failedLocale === locale ? "alert" : "status"}
          className="max-w-md rounded-panel border border-border bg-card p-6 text-center"
        >
          <h1 className="text-base font-semibold">
            {failedLocale === locale
              ? startup.languageFileError
              : startup.loadingScreen}
          </h1>
          {failedLocale === locale && (
            <button
              type="button"
              className="mt-4 min-h-11 rounded-control bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground"
              onClick={() => window.location.reload()}
            >
              {startup.checkAgain}
            </button>
          )}
        </div>
      </main>
    );
  }
  return (
    <LocaleContext.Provider value={value}>
      {(pendingLocale || switchFailure) && (
        <div
          role={switchFailure ? "alert" : "status"}
          lang={switchFailure ?? pendingLocale!}
          dir={directionForLocale(switchFailure ?? pendingLocale!)}
          className="fixed inset-x-4 top-4 z-[100] mx-auto max-w-lg rounded-panel border bg-card p-4 text-sm shadow-lg"
        >
          <p>
            {switchFailure
              ? setupMessages[switchFailure].languageFileError
              : setupMessages[pendingLocale!].loadingScreen}
          </p>
          {switchFailure && (
            <button
              type="button"
              className="min-h-11 px-3 underline"
              onClick={() => chooseLocale(switchFailure)}
            >
              {setupMessages[switchFailure].checkAgain}
            </button>
          )}
          <button
            type="button"
            className="min-h-11 px-3 underline"
            onClick={() => {
              ++switchRevision.current;
              setPendingLocale(null);
              setSwitchFailure(null);
            }}
          >
            {value.t("close")}
          </button>
        </div>
      )}
      <div inert={pendingLocale !== null}>{children}</div>
    </LocaleContext.Provider>
  );
}

export function useLocale(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used inside LocaleProvider");
  return context;
}

// Shared primitives also render independently in previews and server tests.
export function useUiText(): (key: keyof typeof previewUiMessages) => string {
  const context = useContext(LocaleContext);
  return context?.t ?? ((key) => previewUiMessages[key]);
}
