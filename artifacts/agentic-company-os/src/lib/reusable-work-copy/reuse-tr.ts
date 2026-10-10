import type { ReusableWorkCopy } from "../reusable-work-copy";

export default {
  incomingTitle: "Hangi açıklamayla devam edeceğinizi seçin",
  incomingHelp:
    "Gelen açıklamayla değiştirmeyi seçene kadar mevcut taslağınız korunur.",
  keepCurrent: "Mevcut taslağı koru",
  useIncoming: "Gelen açıklamayı kullan",
  choiceError:
    "Bu sekme seçiminizi koruyamadı. Düzenlenebilir metin burada duruyor. İş başlatmadan önce seçiminizi tekrar deneyin.",
  preparationOnly:
    "Bu seçim yalnız taslağı hazırlar; iş başlatmaz veya araç erişimi vermez.",
  savedBrief: "Kayıtlı iş açıklaması",
  useBrief: "Açıklamayı tekrar kullan",
  prepareGuide: "Kişisel rehber hazırla",
  sourceHelp:
    "Bu kaynak kaydından düzenlenebilir metin hazırlayın. Yeni işinize uygunluğunu gözden geçirin; iş başlatmak ayrı bir eylemdir.",
  guideSource:
    "Yerel #{id} projesinin kayıtlı açıklamasından hazırlandı. Tekrar kullanmadan önce gözden geçirin.",
  preparedGuide: "Bu kayıtlı açıklamadan gelen rehberi inceleyin",
  guideTitleHelp:
    "Kaynak başlık aynen korunur. 120 karakterden uzun başlığı kaydetmeden önce düzenleyin. Talimatları ve ajanlara sunma seçimini gözden geçirin.",
  prepareProject: "Proje hazırla",
  disabledGuideHelp:
    "Bu rehber ajanların keşfine kapalıdır. Metniyle proje hazırlamak bu ayarı değiştirmez.",
  runtimeHelp:
    "Yeni iş bu kurulumun seçili bağlantısını, erişim politikasını ve token/maliyet sınırlarını kullanır. Başlatmadan önce Ayarlar'ı inceleyin.",
  waitingGuide:
    "Gelen rehberi incelemeden önce önceki kaydın kontrolünü tamamlayın.",
} satisfies ReusableWorkCopy;
