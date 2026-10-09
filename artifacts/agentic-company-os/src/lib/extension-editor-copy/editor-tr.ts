import type { ExtensionEditorCopy } from "../extension-editor-copy";
export default {
  storageError:
    "Bu sekme taslağı veya kayıt isteğini saklayamadı ya da temizleyemedi. Düzenlediğin metin burada kalır; sayfayı yenilemek kaydedilmemiş değişiklikleri kaybettirebilir. İstek saklanmadan kayıt başlatılmaz.",
  pendingTitle: "Tekrar kaydetmeden önce bu kaydı kontrol et",
  uncertain:
    "Kayıt yanıtı doğrulanamadı. Aynı rehber kimliği ve gönderilen sürüm korunur; otomatik tekrar yapılmaz.",
  check: "Kayıtlı içeriği kontrol et",
  retry: "Gönderilen kaydı tekrar dene",
  continue: "Düzenlemeye devam et",
  matching:
    "Şu an saklanan kimlik, içerik, erişilebilirlik ve sürüm gönderdiğin kayıtla eşleşiyor. Bu bir içerik kontrolüdür; işlem makbuzu değildir.",
  missing:
    "Bu okuma yeni bir kayıtlı sürüm bulamadı. İlk istek hâlâ tamamlanabilir. Tekrar denemek aynı kimliği, içeriği ve beklenen sürümü gönderir.",
  changed:
    "Kayıtlı rehber gönderilen içerikten farklı. Devam etmeden önce kayıtlı içeriği incele; kayıt isteği tekrarlanmaz.",
  invalid:
    "Kayıtlı içerik doğrulanamadı. Gönderilen kayıt burada korunur. Bağlantı kullanılabilir olduğunda tekrar kontrol et.",
  validation:
    "Kaydetmeden önce kimliği ve zorunlu alanları düzelt: başlık en çok 120, açıklama 2.000, talimat veya kod 8.000, JSON paketi 16.000 karakter. Araç varsayılanları bir JSON nesnesi olmalı. Metin otomatik kısaltılmaz.",
  availability: "Kaydettikten sonra ajanlara sun",
  incomingHelp:
    "Düzenlediğin bir taslak zaten var. Onu koru veya seçilen rehber ya da içe aktarılan içerikle açıkça değiştir.",
  keep: "Mevcut editör taslağını koru",
  use: "Seçilen rehberi kullan",
  reviewCurrent: "Düzenlemelerimi kayıtlı sürümle koru",
  storedVersion: "Şu an kayıtlı rehber",
  storedAvailability: "Kayıtlı sürümde ajanlara açık",
  reviewHelp:
    "Aşağıdaki kayıtlı metni incele. Devam etmek düzenlediğin metni korur ve sonraki açık Kaydet işlemi için bu okunan sürümü kullanır. Yeni izin vermez.",
} satisfies ExtensionEditorCopy;
