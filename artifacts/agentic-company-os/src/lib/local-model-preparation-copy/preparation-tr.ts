import type { ModelPreparationCopy } from "../local-model-preparation-copy";
export default {
  pendingHint: "Bu modeli bekleyen mevcut işler devam edebilir.",
  title: "Yerel model edin",
  description: "Kayıtlı Ollama sunucunuza küçük bir başlangıç modeli indirin.",
  download: "Modeli indir",
  stop: "İndirmeyi durdur",
  checking: "İndirilen model kontrol ediliyor",
  returnToJob: "İşime dön",
  available: "Yerel model kullanılabilir",
  preparing: "İndirme hazırlanıyor",
  downloading: "Model dosyaları indiriliyor",
  stopping: "Bu indirme isteği durduruluyor",
  interrupted:
    "İndirme kesildi. Yeniden denemeden önce modeli kontrol edin. Sunucuda kısmi dosyalar kalmış olabilir.",
  failed:
    "İndirme doğrulanamadı. Yeniden denemeden önce sunucuyu kontrol edin.",
  unknown:
    "İndirme isteğinin alındığı doğrulanamıyor. Yeniden denemeden önce durumunu kontrol edin veya bu isteği durdurun.",
  check: "İndirmeyi kontrol et",
  install: "Ollama'yı kur veya güncelle",
  where:
    "Modeli çalıştıracak bilgisayarın veya sunucunun işletim sistemini seçin.",
  storage:
    "Yaklaşık 2 GB model dosyası ve geçici dosyalar için ek boş alan gerekir. Telefonunuzun depolamasını değil, bağlı bilgisayarın veya sunucunun internetini ve diskini kullanır.",
  saveFirst: "İndirmeden önce sunucu adresini kaydedip kontrol edin.",
  continues:
    "İndirme sırasında bu pencereyi kapatabilirsiniz. Durdurma yalnızca bu isteği etkiler; diğer kullanıcıların indirmeleri sürebilir.",
  reset:
    "Sunucu aktarımın bir bölümünü yeniden başlattı. Gözlemlenen bayt sayısı azaldı.",
  unavailable:
    "Ollama'ya ulaşılamıyor. Modeli çalıştıracak bilgisayara veya sunucuya kurun ya da orada başlatın, ardından yeniden kontrol edin.",
  update:
    "Bu başlangıç modeli Ollama 0.40.3 veya üzerini gerektirir. Bağlı sunucuyu güncelleyip yeniden kontrol edin.",
  changed:
    "Kayıtlı bağlantı değişti. Yeniden indirmeden önce geçerli sunucuyu kontrol edin.",
  readyHint:
    "Taslağınıza dönüp ne zaman başlayacağınıza karar verin. Bu modeli bekleyen mevcut işler devam edebilir.",
  bytes: "Gözlemlenen model verisi",
} satisfies ModelPreparationCopy;
