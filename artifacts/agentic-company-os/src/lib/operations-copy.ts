import type { Locale } from "./i18n";
import type english from "./operations-copy/operations-en";
import type { OperationsRoomTruth } from "./operations-view-model";

export type OperationsCopy = { [K in keyof typeof english]: string };
export type OperationsCopyKey = keyof OperationsCopy;
export const OPERATIONS_DISPLAY_TIMEZONE = "Europe/Istanbul";
const loaders = {
  tr: () => import("./operations-copy/operations-tr"),
  en: () => import("./operations-copy/operations-en"),
  de: () => import("./operations-copy/operations-de"),
  ru: () => import("./operations-copy/operations-ru"),
  "zh-CN": () => import("./operations-copy/operations-zh-CN"),
  "zh-TW": () => import("./operations-copy/operations-zh-TW"),
  ar: () => import("./operations-copy/operations-ar"),
};
export async function loadOperationsCopy(
  locale: Locale,
): Promise<OperationsCopy> {
  return (await loaders[locale]()).default;
}

export function operationsPresentation(copy: OperationsCopy, locale: Locale) {
  const number = new Intl.NumberFormat(locale);
  const t = (
    key: OperationsCopyKey,
    values: Record<string, string | number> = {},
  ) =>
    copy[key].replace(/\{(\w+)\}/g, (placeholder, name: string) =>
      values[name] === undefined ? placeholder : String(values[name]),
    );
  const time = (value: string | null) => {
    const parsed = value === null ? NaN : Date.parse(value);
    return Number.isFinite(parsed)
      ? `${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "medium", timeZone: OPERATIONS_DISPLAY_TIMEZONE }).format(parsed)} · ${OPERATIONS_DISPLAY_TIMEZONE}`
      : copy.unknownTime;
  };
  const duration = (value: number | null) => {
    if (value === null || !Number.isFinite(value)) return copy.unknownTime;
    const seconds = Math.max(0, Math.floor(value / 1000));
    const unit = seconds < 60 ? "second" : seconds < 3600 ? "minute" : "hour";
    const count =
      unit === "second"
        ? seconds
        : unit === "minute"
          ? Math.floor(seconds / 60)
          : Math.floor(seconds / 3600);
    return new Intl.NumberFormat(locale, {
      style: "unit",
      unit,
      unitDisplay: "short",
    }).format(count);
  };
  const state = (value: string) => {
    const key = `state_${value}` as OperationsCopyKey;
    return Object.hasOwn(copy, key) ? copy[key] : t("unknownState", { value });
  };
  const truthLabel = (truth: OperationsRoomTruth) => {
    const backend = () => {
      switch (truth.backendState) {
        case "live":
          return t("live", { count: number.format(truth.healthyWorkerCount) });
        case "degraded":
          return copy.degradedTruth;
        case "stale":
          return copy.staleTruth;
        case "offline":
          return copy.offlineTruth;
        case "emergency_stopped":
          return copy.emergencyTruth;
        case "local_demo":
          return copy.demoTruth;
      }
    };
    if (
      ["local_demo", "emergency_stopped", "offline"].includes(
        truth.backendState,
      )
    )
      return backend();
    const age =
      truth.transportAgeMs === null
        ? copy.unknownTime
        : t("ago", { duration: duration(truth.transportAgeMs) });
    switch (truth.transportState) {
      case "disconnected":
        return t("disconnected", { age });
      case "stale":
        return t("staleStream", { age });
      case "connecting":
        return copy.connecting;
      case "disabled":
        return copy.disabledStream;
      case "live":
        return backend();
    }
  };
  return {
    copy,
    locale,
    t,
    number,
    time,
    duration,
    state,
    truthLabel,
    currency: (value: number) =>
      new Intl.NumberFormat(locale, {
        style: "currency",
        currency: "USD",
      }).format(value),
    percent: (value: number) =>
      new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 0,
      }).format(value / 100),
    until: (value: string | null, now: Date) =>
      !value
        ? copy.noWake
        : !Number.isFinite(Date.parse(value))
          ? copy.unknownTime
          : Date.parse(value) <= now.getTime()
            ? copy.now
            : t("after", {
                duration: duration(Date.parse(value) - now.getTime()),
              }),
  };
}
