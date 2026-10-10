import type { ConnectionCopy } from "../connection-copy";
export default {
  apiProviders: "API sağlayıcısı",
  signedOut: "Bu hesabın oturumu kapalı. Kullanmadan önce yeniden giriş yap.",
  signInAgain: "Yeniden giriş yap",
  clearAttempt: "Sona eren girişi temizle",
  description:
    "Bağlantıyı kurarken işin bu ekranda kalır. Sağlayıcı bekleyen mevcut işler bağlantı kaydedilince devam edebilir.",
  local: "Yerel model",
  localHint: "Bu bilgisayardaki veya özel sunucudaki Ollama’yı kullan.",
  allowCloud: "Bu sunucu için bulut modellerine izin ver",
  cloudUsage:
    "Bulut modelleri istemleri Ollama bulutuna gönderir ve o hesabın kullanım hakkını veya ücretlerini kullanır. Kaydetmek model isteği göndermez.",
  localLocation: "Yerelde çalışır",
  cloudLocation: "Ollama bulutunu kullanır",
  unknownLocation: "Konum doğrulanamadı",
  localRequirement:
    "Yerel çalışmanın zorunlu tutulması için Ollama 0.18.0 veya sonrası gerekir. Sunucuyu güncelle, sonra bağlantıyı yeniden denetle.",
  localVerified:
    "Yerel modeller bu sunucunun donanımını kullanır. Araç desteği ayrıca gösterilir.",
  cloudOff: "Kaydedilen sunucu için bulut izni kapalı.",
  cloudOn: "Kaydedilen sunucu için bulut izni açık.",
  chatgptHint: "Uygun ChatGPT planını kullan; izinler ve kota geçerlidir.",
  api: "API anahtarı",
  apiHint:
    "Kendi anahtarınla OpenAI veya OpenRouter’a bağlan. Sağlayıcı ücreti uygulanabilir.",
  back: "Tüm bağlantı seçenekleri",
  endpoint: "Ollama adresi",
  endpointHint:
    "Bu adrese telefonun değil backend ulaşır. Özel bir HTTP(S) adresi kullan.",
  save: "Bağlantıyı kaydet",
  restore: "Kurulum varsayılanını kullan",
  restoreHint:
    "Kaydedilen adresi kaldırır. Ortam değişkenindeki adres etkin kalır.",
  key: "API anahtarı",
  keyHint:
    "Anahtar backend’de güvenle kaydedilene kadar bellekte kalır. Tarayıcı depolamasında tutulmaz.",
  saved:
    "Bağlantı kaydedildi. Bulunan modeller henüz bir model isteğiyle denenmedi.",
  unconfirmed:
    "Kaydetme doğrulanamadı. Yeniden kaydetmeden önce mevcut bağlantıyı denetle.",
  invalid: "Adresi veya anahtarı kontrol edip yeniden dene.",
  changed: "Bağlantı değişti. Yeniden kaydetmeden önce mevcut durumunu oku.",
  discovered: "Bulunan modeller",
  none: "Henüz araç kullanabilen model yok. Sağlayıcıyı denetle; Ollama için model ekleyip yeniden denetle.",
  tools: "Araç kullanabilir",
  chatOnly: "Yalnız sohbet",
  advanced: "Gelişmiş ayarlar ve isteğe bağlı model testi",
  done: "İşime dön",
  accounts: "Kaydedilmiş hesaplar",
  noAccounts: "Henüz kaydedilmiş hesap yok.",
  selected: "Seçili",
  select: "Bu hesabı seç",
  identityOnly:
    "Yalnız kimlik için giriş yapıldı. Modeller için plan izni ver.",
  planReady:
    "Plan izni verildi. Kullanılabilirlik ve kota işi çalıştırınca denetlenir.",
  paused:
    "Plan kullanımı duraklatıldı. İşi yeniden denemeden önce sınırı incele.",
  signIn: "ChatGPT ile devam et",
  sameComputer: "Tarayıcı ve backend aynı bilgisayarda çalışıyor.",
  officialLink: "Resmî giriş sayfasını aç",
  pending: "Giriş bekleniyor. Resmî sayfadaki işlemi bitirip durumu denetle.",
  review:
    "Kaydetmeden önce bu hesabı incele. Kaydetmek hesabı seçmez veya işini başlatmaz.",
  confirm: "İncelenen hesabı kaydet",
  cancel: "Girişi iptal et",
  connected: "Hesap kaydedildi. Kullanmak için açıkça seç.",
  ended: "Bu giriş sona erdi. Önceki hesap seçimin değişmedi.",
  handoffTitle: "Telefon, sunucu veya konteyner",
  handoffText:
    "Uzaktaki tarayıcı backend’in özel geri dönüş adresine ulaşamaz. Kendi bilgisayarında giriş yapıp korumalı kaydı rehberdeki yöntemle sunucuya aktar. Buraya kimlik bilgisi yapıştırma.",
  handoffGuide: "Güvenli aktarım rehberini aç",
  enablePlan: "Plan izni ver",
  refresh: "Mevcut bağlantıyı denetle",
  unknown:
    "Sonuç doğrulanamadı. Mevcut durumu oku; aynı eylemi körlemesine tekrarlama.",
} satisfies ConnectionCopy;
