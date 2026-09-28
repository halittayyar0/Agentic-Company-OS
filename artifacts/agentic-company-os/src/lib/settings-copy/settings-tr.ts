import type { SettingsCopy } from "../settings-copy";
const copy: SettingsCopy = {
  title: "Bağlantılar ve ayarlar",
  description: "Model erişimini, dili ve çalışma alanının görünümünü yönet.",
  preferences: "Tercihlerin",
  appearance: "Görünüm",
  light: "Açık",
  dark: "Koyu",
  system: "Cihazı izle",
  appearanceHelp: "Görünüm tercihi bu tarayıcıda saklanır.",
  providers: "Model sağlayıcıları",
  credentialHelp:
    "Kayıtlı anahtar bağlantının çalıştığını kanıtlamaz. Önce kaydet, ardından seçtiğin modeli açıkça test et.",
  key: "Yeni API anahtarı",
  sourceRuntime: "Kayıtlı anahtar",
  sourceEnvironment: "Sunucu ortamındaki anahtar",
  sourceNone: "Anahtar yapılandırılmamış",
  save: "Anahtarı kaydet",
  remove: "Kayıtlı anahtarı kaldır",
  removeHelp:
    "Uygulamada saklanan anahtar kaldırılsın mı? Sunucu ortamında anahtar varsa devreye girer. Devam eden istekler önceki anahtarla tamamlanabilir.",
  storedLocal:
    "Anahtarlar sunucudaki yerel dosyada, uygulama düzeyinde şifrelenmeden saklanır. Sunucu hesabını ve yedeklerini koru.",
  storedDatabase:
    "Anahtarlar ortak veritabanında şifrelenir. Worker süreçleri değişikliği eşzamansız alır; bu ekran her worker’ın değişikliği uyguladığını doğrulamaz.",
  serverManaged: "Sunucudan yönetilir",
  serverHelp:
    "Bu sağlayıcıyı sunucuda yapılandır. Bu ekran sunucu ayarlarını değiştirmez.",
  unavailable: "Mevcut katalogda kullanılamıyor",
  test: "Modeli test et",
  testHelp:
    "Seçilen sağlayıcıya kısa bir komut gönderilir ve ücret doğabilir. Çıktı 10 token ile sınırlıdır; sunucu 20 saniye sonra beklemeyi bırakır ve otomatik yeniden deneme yapmaz. Zaman aşımı, sağlayıcının işlemeyi durdurduğunu kanıtlamaz.",
  confirmTest: "Test isteğini gönder",
  cancel: "Vazgeç",
  saved:
    "Sunucu ayarların kaydedildiğini doğruladı. Bu, model erişimini veya tüm worker’lara uygulanmasını doğrulamaz.",
  changed:
    "Ayarlar başka bir yerde değişti. Yeniden denemeden önce yenile ve incele.",
  unconfirmed:
    "Kayıt doğrulanamadı; değişiklik uygulanmış olabilir. Tekrar göndermeden önce sunucu durumunu yenileyip incele. Taslak yalnız bu sayfada kalır.",
  refresh: "Ayarları yenile",
  busy: "İşleniyor…",
  draftHelp:
    "Taslak anahtarlar tarayıcı depolamasına yazılmaz. Sayfadan ayrılmak veya yeniden yüklemek taslağı siler.",
  loading: "Sağlayıcı ayarları yükleniyor…",
  loadError:
    "Sağlayıcı ayarları alınamadı. Anahtar ve bağlantı durumu bilinmiyor.",
  stale:
    "Son alınan ayarlar gösteriliyor. Değişiklik yapmadan veya test göndermeden önce başarıyla yenile.",
  rateLimited:
    "Çok fazla istek gönderildi. Bir dakika bekle, ardından yenileyip tekrar dene.",
  testFailed:
    "Test doğrulanamadı. Sağlayıcı isteği işlemiş veya ücretlendirmiş olabilir. Otomatik yeniden deneme gönderilmedi.",
  testPassed: "Bu model test isteğine yanıt verdi.",
  testHistorical:
    "Bu sonuç gösterilen ayar sürümüne aittir; sürekli izleme veya başka modeller için garanti değildir.",
  testBlocked:
    "Acil durdurma etkinken veya durumu bilinmiyorken test kullanılamaz.",
  revision: "Ayar sürümü",
  selectedModel: "Test edilecek model",
  catalog: "Model kataloğu",
  catalogHelp:
    "Modeller ve açıklamaları sunucu kataloğundan gelir. Erişim, fiyat ve sınırlar değişebilir; kullanmadan önce sağlayıcıdan kontrol et.",
  search: "Model ara",
  tools: "Araç desteği var",
  chatOnly: "Yalnız sohbet",
  economy: "Ekonomik",
  standard: "Standart",
  premium: "Üst seviye",
  reasoning: "Akıl yürütme",
  freeIdentifier: "Ücretsiz katman kimliği; sağlayıcı sınırlarını kontrol et",
  defaultModel: "Varsayılan model",
  more: "Daha fazla model göster",
  empty: "Bu aramayla eşleşen model yok.",
  source: "Katalogdaki özgün açıklama",
  runtime: "Sunucu çalışması",
  browserHelp:
    "Tarayıcının görünürlüğü sunucu başlatılırken belirlenir. Bu ekran mevcut modu okumaz veya değiştirmez.",
  hostHelp:
    "Host komutları hizmet hesabının işletim sistemi yetkileriyle, izolasyon veya yetki yükseltmesi olmadan çalışır. Sunucu izole değilse ve verilen erişimi anlamıyorsan bu özellikleri kapalı tut.",
  hostSettings:
    "Host işlemleri varsayılan olarak kapalıdır. Sunucu yapılandırması:",
  clear: "Aramayı temizle",
  removeTitle: "Bu kayıtlı anahtar kaldırılsın mı?",
  notTested: "Bu ziyarette test sonucu yok",
  elapsed: "Yanıt süresi (ms)",
  currentChanged: "Bu sonuç eski bir ayar sürümüne ait.",
  noDescription: "Açıklama sağlanmadı.",
};
export default copy;
