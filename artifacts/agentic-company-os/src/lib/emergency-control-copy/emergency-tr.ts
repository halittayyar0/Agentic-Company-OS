import type { EmergencyControlCopy } from "../emergency-control-copy";

export default {
  checking: "Acil durdurma durumu okunuyor",
  retryLabel: "Acil durdurma durumunu yeniden denetle",
  unavailable: "Acil durdurma durumu okunamadı",
  stop: "Acil durdur",
  resume: "Devam ettir",
  resumeLabel: "Çalışmayı devam ettir",
  stopTitle: "Tüm ajan çalışmasını durdur",
  resumeTitle: "Ajan çalışmasını devam ettir",
  stopDescription:
    "Bu güvenlik freni ajan sohbetini, görev yürütmeyi, ajan araçlarını ve onaylı eylemleri durdurur. Mevcut dış etkileri geri almaz.",
  resumeDescription:
    "Görev zamanlayıcısı, ajan sohbeti, araçlar ve onaylı eylemler yeniden çalışabilir. Devam etmeden önce çalışma alanının güvenli olduğunu doğrula.",
  reason: "Durdurma sebebi",
  reasonPlaceholder: "Örn. Beklenmeyen tarayıcı eylemi inceleniyor",
  reasonHelp: "En az 3 karakter; işlem kaydına yazılır.",
  actionError: "İşlem tamamlanamadı. Yeniden dene.",
  cancel: "Vazgeç",
  applying: "Uygulanıyor…",
  confirmResume: "Evet, çalışmayı devam ettir",
  confirmStop: "Evet, tüm çalışmayı durdur",
  safetyUnknown:
    "Güvenlik freni durumu doğrulanamıyor; yeni riskli işlemler kapalı.",
  retry: "Yeniden denetle",
  stopActive: "Acil durdurma etkin.",
} satisfies EmergencyControlCopy;
