export const LOCALES = [
  "tr",
  "en",
  "de",
  "ru",
  "zh-CN",
  "zh-TW",
  "ar",
] as const;

export type Locale = (typeof LOCALES)[number];

export const LOCALE_STORAGE_KEY = "acos.locale.v1";

export const LANGUAGE_OPTIONS: ReadonlyArray<{
  code: Locale;
  nativeName: string;
  englishName: string;
}> = [
  { code: "tr", nativeName: "Türkçe", englishName: "Turkish" },
  { code: "en", nativeName: "English", englishName: "English" },
  { code: "de", nativeName: "Deutsch", englishName: "German" },
  { code: "ru", nativeName: "Русский", englishName: "Russian" },
  { code: "zh-CN", nativeName: "简体中文", englishName: "Simplified Chinese" },
  { code: "zh-TW", nativeName: "繁體中文", englishName: "Traditional Chinese" },
  { code: "ar", nativeName: "العربية", englishName: "Arabic" },
];

export type ShellMessages = {
  skillsLibrary: string;
  skillsLoadError: string;
  historyPages: string;
  historyOlder: string;
  historyNewer: string;
  historyLatest: string;
  historyWindow: string;
  historyPaused: string;
  historyLoading: string;
  historyError: string;
  historyPageFilters: string;
  eventRuntimeRegistered: string;
  eventRuntimeStateChanged: string;
  eventAttemptCreated: string;
  eventAttemptStateChanged: string;
  eventReceiptReserved: string;
  eventReceiptStateChanged: string;
  eventInvocationCreated: string;
  eventInvocationStateChanged: string;
  eventRecoveryRecorded: string;
  eventRuntimeControlChanged: string;
  eventReconciliationRecorded: string;
  eventHealthSampleRecorded: string;
  chooseLanguage: string;
  setupDescription: string;
  continue: string;
  language: string;
  languageDescription: string;
  translationPreview: string;
  localeSaving: string;
  localeSaved: string;
  localeError: string;
  home: string;
  projects: string;
  companyRoom: string;
  experts: string;
  teams: string;
  operations: string;
  activity: string;
  approvals: string;
  connections: string;
  workspaceGroup: string;
  companyGroup: string;
  controlGroup: string;
  skipToContent: string;
  openMenu: string;
  closeMenu: string;
  mainMenu: string;
  workingExperts: string;
  switchToLight: string;
  switchToDark: string;
  signOut: string;
  signOutSecure: string;
  signingOut: string;
  signOutFailed: string;
  signOutRetry: string;
  close: string;
  clearSearch: string;
  searchPagesAndExperts: string;
  commandDescription: string;
  noResults: string;
  pages: string;
  commandResults: string;
  expertsLoading: string;
  expertsRetry: string;
  projectStartBlocked: string;
  providerSetupMessage: string;
  providerSetupAction: string;
  notifications: string;
  openSearch: string;
  search: string;
  createNew: string;
  new: string;
  newProject: string;
  newTeam: string;
  newExpert: string;
  project: string;
  projectOperations: string;
  expertDetail: string;
  agentChat: string;
  settings: string;
  systemChecking: string;
  systemReady: string;
  apiUnavailable: string;
  checkAgain: string;
  localWorkspace: string;
  openSource: string;
  pageNotFound: string;
  pageNotFoundDescription: string;
  backHome: string;
  loadingScreen: string;
  homeCopyError: string;
  projectListCopyError: string;
  newProjectCopyError: string;
  agentDirectoryCopyError: string;
  newAgentCopyError: string;
  authCopyError: string;
  workforceCopyError: string;
  roomCopyError: string;
  approvalCopyError: string;
};
export type MessageKey = keyof ShellMessages;
export const setupMessages = {
  tr: {
    chooseLanguage: "Dilini seç",
    setupDescription:
      "Çalışma alanının dilini seç. Bunu daha sonra Ayarlar'dan değiştirebilirsin.",
    continue: "Devam et",
    language: "Dil",
    translationPreview:
      "Çeviriler henüz doğrulanmadı. Metinleriniz ve geçmiş kayıtlar özgün dilinde kalır.",
    loadingScreen: "Ekran yükleniyor",
    checkAgain: "Yeniden denetle",
    languageFileError: "Arayüzün dil dosyası yüklenemedi.",
  },
  en: {
    chooseLanguage: "Choose your language",
    setupDescription:
      "Choose the language for your workspace. You can change it later in Settings.",
    continue: "Continue",
    language: "Language",
    translationPreview:
      "Translations await review. Your content and history keep their original language.",
    loadingScreen: "Loading page",
    checkAgain: "Check again",
    languageFileError: "Could not load the interface language file.",
  },
  de: {
    chooseLanguage: "Sprache wählen",
    setupDescription:
      "Wähle die Sprache für deinen Arbeitsbereich. Du kannst sie später in den Einstellungen ändern.",
    continue: "Weiter",
    language: "Sprache",
    translationPreview:
      "Übersetzungen stehen zur Prüfung aus. Eigene Inhalte und frühere Einträge bleiben in der Originalsprache.",
    loadingScreen: "Seite wird geladen",
    checkAgain: "Erneut prüfen",
    languageFileError:
      "Die Sprachdatei der Oberfläche konnte nicht geladen werden.",
  },
  ru: {
    chooseLanguage: "Выберите язык",
    setupDescription:
      "Выберите язык рабочего пространства. Позже его можно изменить в настройках.",
    continue: "Продолжить",
    language: "Язык",
    translationPreview:
      "Переводы ожидают проверки. Ваши тексты и прежние записи сохраняют исходный язык.",
    loadingScreen: "Загрузка страницы",
    checkAgain: "Проверить снова",
    languageFileError: "Не удалось загрузить языковой файл интерфейса.",
  },
  "zh-CN": {
    chooseLanguage: "选择语言",
    setupDescription: "选择工作区语言。稍后可在设置中更改。",
    continue: "继续",
    language: "语言",
    translationPreview: "译文有待审核。你的内容和历史记录保留原始语言。",
    loadingScreen: "正在加载页面",
    checkAgain: "重新检查",
    languageFileError: "无法加载界面语言文件。",
  },
  "zh-TW": {
    chooseLanguage: "選擇語言",
    setupDescription: "選擇工作區語言。之後可在設定中變更。",
    continue: "繼續",
    language: "語言",
    translationPreview: "譯文有待審核。你的內容與歷史紀錄保留原始語言。",
    loadingScreen: "正在載入頁面",
    checkAgain: "重新檢查",
    languageFileError: "無法載入介面語言檔案。",
  },
  ar: {
    chooseLanguage: "اختر لغتك",
    setupDescription:
      "اختر لغة مساحة العمل. يمكنك تغييرها لاحقًا من الإعدادات.",
    continue: "متابعة",
    language: "اللغة",
    translationPreview:
      "الترجمات بانتظار المراجعة. تبقى نصوصك والسجلات السابقة بلغتها الأصلية.",
    loadingScreen: "جارٍ تحميل الصفحة",
    checkAgain: "أعد الفحص",
    languageFileError: "تعذّر تحميل ملف لغة الواجهة.",
  },
};
export type ShellPack = Omit<ShellMessages, keyof (typeof setupMessages)["tr"]>;

// Standalone primitives need only these labels. Do not make every selected
// language download the entire Turkish shell just to support component previews.
export const previewUiMessages = {
  switchToLight: "Açık temaya geç",
  switchToDark: "Koyu temaya geç",
  close: "Kapat",
  clearSearch: "Aramayı temizle",
  searchPagesAndExperts: "Sayfa veya uzman ara",
  commandDescription: "Bir sayfaya git, yeni bir iş başlat veya uzmanını bul.",
  notifications: "Bildirimler",
  search: "Ara",
} as const satisfies Partial<ShellMessages>;
const loaded = new Map<Locale, ShellMessages>();
const LOADERS = {
  tr: () => import("./shell-copy/shell-tr"),
  en: () => import("./shell-copy/shell-en"),
  de: () => import("./shell-copy/shell-de"),
  ru: () => import("./shell-copy/shell-ru"),
  "zh-CN": () => import("./shell-copy/shell-zh-CN"),
  "zh-TW": () => import("./shell-copy/shell-zh-TW"),
  ar: () => import("./shell-copy/shell-ar"),
};
export function cachedShellMessages(locale: Locale): ShellMessages | undefined {
  return loaded.get(locale);
}
export async function loadShellMessages(
  locale: Locale,
): Promise<ShellMessages> {
  const cached = loaded.get(locale);
  if (cached) return cached;
  const pack = (await LOADERS[locale]()).default;
  const copy: ShellMessages = { ...setupMessages[locale], ...pack };
  loaded.set(locale, copy);
  return copy;
}

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && LOCALES.some((locale) => locale === value)
  );
}

export function directionForLocale(locale: Locale): "ltr" | "rtl" {
  return locale === "ar" ? "rtl" : "ltr";
}
