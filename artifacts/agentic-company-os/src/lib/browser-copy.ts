import type { Locale } from "./i18n";
export type BrowserCopy = {
  zoomIn: string;
  zoomOut: string;
  title: string;
  help: string;
  address: string;
  go: string;
  addressInvalid: string;
  take: string;
  release: string;
  ownerAgent: string;
  ownerOperator: string;
  ownerOther: string;
  agentBusy: string;
  blocked: string;
  loading: string;
  refresh: string;
  pause: string;
  resume: string;
  polling: string;
  paused: string;
  syncLost: string;
  received: string;
  empty: string;
  imageLabel: string;
  frameHelp: string;
  textLabel: string;
  textHelp: string;
  textInvalid: string;
  send: string;
  busy: string;
  sent: string;
  unknown: string;
  unknownHelp: string;
  review: string;
  reviewCheck: string;
  reviewDone: string;
  reviewRequired: string;
  error: string;
  close: string;
  closeTitle: string;
  closeHelp: string;
  cancel: string;
  confirm: string;
  fullscreen: string;
  exitFullscreen: string;
  fullscreenError: string;
  back: string;
  forward: string;
  reload: string;
  tab: string;
  shiftTab: string;
  enter: string;
  backspace: string;
  escape: string;
  up: string;
  down: string;
  left: string;
  right: string;
  scrollUp: string;
  scrollDown: string;
  storageError: string;
  retryStorage: string;
  damaged: string;
  draftsHint: string;
  windowVisible: string;
  windowHidden: string;
};
const loaders = {
  en: () => import("./browser-copy/browser-en"),
  tr: () => import("./browser-copy/browser-tr"),
  de: () => import("./browser-copy/browser-de"),
  ru: () => import("./browser-copy/browser-ru"),
  "zh-CN": () => import("./browser-copy/browser-zh-CN"),
  "zh-TW": () => import("./browser-copy/browser-zh-TW"),
  ar: () => import("./browser-copy/browser-ar"),
};
export async function loadBrowserCopy(locale: Locale): Promise<BrowserCopy> {
  return (await loaders[locale]()).default;
}
