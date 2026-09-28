import type { OperatorCopy } from "../operator-copy";
const copy: OperatorCopy = {
  check: "Sunucu kaydını kontrol et",
  checking: "Sunucu kaydı kontrol ediliyor…",
  help: "Kontrol yalnız bu isteğin kaydını okur. İşlemi yeniden çalıştırmaz veya iptal etmez.",
  legacy:
    "Bu eski yerel kayıtta sunucudan kurtarma kimliği yok. Temizlemeden önce etkilerini inceleyin.",
  reserved:
    "Sunucu isteği kaydetti; çalıştırılmak üzere gönderildiği henüz doğrulanmadı.",
  dispatched: "Gönderim kaydedildi; işlemin sonucu henüz doğrulanmadı.",
  complete: "Sunucu tamamlandığını kaydetti.",
  unavailable:
    "İşlem tamamlandı ancak kayıtlı çıktısına ulaşılamıyor. Çıktıyı almak için işlemi tekrarlamayın.",
  not_dispatched:
    "Sunucu bu isteğin çalıştırılmak üzere gönderilmediğini kaydetti.",
  unknown: "İşlem çalışmış olabilir. Sonucu hâlâ doğrulanamadı.",
  missing:
    "Eşleşen kayıt bulunamadı. Bu, işlemin hiç çalışmadığını kanıtlamaz.",
  error: "Sunucu kaydı doğrulanamadı. Uyarıyı koruyup tekrar kontrol edin.",
  browser:
    "Kayıtlı tarayıcı işlemi kontrol yetkisini geri getirmez. Yeniden kontrol almadan önce güncel sayfayı inceleyin.",
  review: "Yerel uyarıyı incele",
  reviewHelp:
    "Bu sekmedeki uyarıyı temizlemeden önce olası etkileri inceleyin. Temizlemek işlemi durdurmaz veya tekrarlamaz.",
  reviewCheck:
    "Etkileri inceledim; temizlemenin yalnız bu yerel uyarıyı kaldırdığını anlıyorum.",
  finish: "Yerel uyarıyı temizle",
  cancel: "Vazgeç",
  changed:
    "Kayıt değişti veya kaydedilemedi. Pencereyi kapatın, güncel kaydı kontrol edip tekrar deneyin.",
};
export default copy;
