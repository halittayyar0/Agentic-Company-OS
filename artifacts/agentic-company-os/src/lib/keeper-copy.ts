import type { Locale } from "./i18n";
export type KeeperCompanionCopy = {
  title: string;
  talk: string;
  idle: string;
  working: string;
  blocked: string;
  archived: string;
  unknown: string;
  ai: string;
};
type MotionCopy = {
  pause: string;
  enable: string;
  live: string;
  calm: string;
  help: string;
};
export const keeperMotionCopy: Record<Locale, MotionCopy> = {
  en: {
    pause: "Pause mascot motion",
    enable: "Enable mascot motion",
    live: "Live mascots",
    calm: "Calm mascots",
    help: "Motion follows your device's reduced-motion setting. This choice stays on this browser.",
  },
  tr: {
    pause: "Maskot hareketini durdur",
    enable: "Maskot hareketini aç",
    live: "Canlı maskotlar",
    calm: "Sakin maskotlar",
    help: "Hareket, cihazının azaltılmış hareket ayarına uyar. Seçimin bu tarayıcıda saklanır.",
  },
  de: {
    pause: "Maskottchenbewegung pausieren",
    enable: "Maskottchenbewegung aktivieren",
    live: "Lebendige Maskottchen",
    calm: "Ruhige Maskottchen",
    help: "Bewegungen beachten die Einstellung für reduzierte Bewegung deines Geräts. Die Auswahl bleibt in diesem Browser.",
  },
  ru: {
    pause: "Остановить анимацию маскотов",
    enable: "Включить анимацию маскотов",
    live: "Живые маскоты",
    calm: "Спокойные маскоты",
    help: "Анимация учитывает настройку уменьшения движения на устройстве. Выбор сохраняется в этом браузере.",
  },
  "zh-CN": {
    pause: "暂停吉祥物动画",
    enable: "开启吉祥物动画",
    live: "动态吉祥物",
    calm: "静态吉祥物",
    help: "动画遵循设备的减少动态效果设置。此选择保存在当前浏览器中。",
  },
  "zh-TW": {
    pause: "暫停吉祥物動畫",
    enable: "開啟吉祥物動畫",
    live: "動態吉祥物",
    calm: "靜態吉祥物",
    help: "動畫遵循裝置的減少動態效果設定。此選擇儲存在目前的瀏覽器中。",
  },
  ar: {
    pause: "إيقاف حركة الشخصيات",
    enable: "تشغيل حركة الشخصيات",
    live: "شخصيات متحركة",
    calm: "شخصيات هادئة",
    help: "تتبع الحركة إعداد تقليل الحركة في جهازك. يُحفظ اختيارك في هذا المتصفح.",
  },
};
