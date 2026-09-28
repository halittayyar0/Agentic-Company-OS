import type { Locale } from "./i18n";

export type AuthCopy = {
  badge: string;
  title: string;
  description: string;
  accessKey: string;
  invalidSession: string;
  loginFailed: string;
  verifying: string;
  signIn: string;
  checkingSession: string;
  serviceUnavailable: string;
  serviceUnavailableDescription: string;
  retry: string;
  invalidKey: string;
};

const LOADERS = {
  tr: () => import("./auth-copy/auth-tr"),
  en: () => import("./auth-copy/auth-en"),
  de: () => import("./auth-copy/auth-de"),
  ru: () => import("./auth-copy/auth-ru"),
  "zh-CN": () => import("./auth-copy/auth-zh-CN"),
  "zh-TW": () => import("./auth-copy/auth-zh-TW"),
  ar: () => import("./auth-copy/auth-ar"),
} satisfies Record<Locale, () => Promise<{ default: AuthCopy }>>;

export async function loadAuthCopy(locale: Locale): Promise<AuthCopy> {
  return (await LOADERS[locale]()).default;
}
