import React, {
  createContext,
  useContext,
  useMemo,
  type ReactNode,
} from "react";
import {
  operationsPresentation,
  type OperationsCopy,
} from "../../lib/operations-copy";
import type { Locale } from "../../lib/i18n";
const Context = createContext<ReturnType<typeof operationsPresentation> | null>(
  null,
);
export function OperationsCopyProvider({
  copy,
  locale,
  children,
}: {
  copy: OperationsCopy;
  locale: Locale;
  children: ReactNode;
}) {
  const value = useMemo(
    () => operationsPresentation(copy, locale),
    [copy, locale],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useOperationsCopy() {
  const value = useContext(Context);
  if (!value) throw new Error("OperationsCopyProvider is required");
  return value;
}
