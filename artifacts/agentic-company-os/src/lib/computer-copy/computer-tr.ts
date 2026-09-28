import type { ComputerCopy } from "../computer-copy";
const copy: ComputerCopy = {
  commandRequired: "Bir komut yazın.",
  title: "Bilgisayar çalışma alanı",
  agentLabel: "{name} bilgisayar çalışma alanı",
  scope:
    "Tarayıcı, komutlar ve dosyalar bu uzmanın ortak çalışma alanına aittir.",
  projectScope:
    "Bu araçlar uzmanın çalışma alanını projeler arasında paylaşır. Buraya yazılan komutlar operatör işlemidir; bu projenin adımları değildir.",
  source: "Özgün kaynak içeriği",
  activity: "İşlem kaydı",
  activityHelp:
    "Bu uzmana ait sayfa başına en fazla 20 kayıt; başka çalışmalara da ait olabilir. Yalnız en son sayfa otomatik yenilenir.",
  projectActivityHelp:
    "Bu projeye göre süzülen, sayfa başına en fazla 20 kayıt. Buradan girilen operatör komutları proje kapsamına bağlı değildir.",
  activityEmpty: "Bu aralıkta kayıt yok.",
  activityError: "İşlem kaydı alınamadı.",
  activityStale: "Yenileme başarısız. Önceden yüklenen kayıtlar gösteriliyor.",
  refresh: "Yenile",
  loading: "Yükleniyor…",
  ready: "Çalışma alanı mevcut",
  notCreated: "İlk kullanımda oluşturulur",
  statusError: "Çalışma alanı durumu doğrulanamadı.",
  bytes: "Saklanan bayt",
  files: "Çalışma dosyaları",
  folders: "Dizinler",
  browser: "Tarayıcı",
  terminal: "Terminal",
  surfaces: "Bilgisayar araçları",
  follow: "Yeni ajan olaylarını takip et",
  followHelp:
    "Yalnız yeni bir ajan olayı geldiğinde araç değiştirir. Yazarken sizi bölmez.",
  permissionOff: "Tarayıcı izni kapalı.",
  terminalHelp:
    "Her istekte bir komut çalışır. Çalışma alanı yolları sınırlıdır; işletim sistemi yalıtımı sağlanmaz.",
  hostHelp:
    "Host komutları API hizmet hesabının işletim sistemi yetkileriyle çalışır. Bu mod sunucuda ayrıca açılmalıdır.",
  host: "Host operatörü",
  workspace: "Çalışma alanı",
  command: "Komut",
  run: "Komutu çalıştır",
  keyboard:
    "Enter satır ekler. Ctrl/Command+Enter, metin oluşturma dışında çalıştırır.",
  tooLong: "Komut 32.768 karakter sınırını aşıyor. Taslak kısaltılmadı.",
  disabled: "Terminal izni kapalı.",
  blocked: "Güvenlik durumu izin verene kadar komut gönderilemez.",
  cwdLoading: "Çalışma dizini doğrulanıyor…",
  cwdError: "Çalışma dizini doğrulanamadı. Komut çalıştırmadan önce yenileyin.",
  folder: "Çalışma dizini",
  running: "İstek gönderildi; sonuç bekleniyor…",
  unconfirmed: "Komut sonucu doğrulanmadı",
  unconfirmedHelp:
    "İşlem çalışmış olabilir. Sonucu hâlâ doğrulanamadı. Kontrol yalnız bu isteğin kaydını okur. İşlemi yeniden çalıştırmaz veya iptal etmez.",
  reviewCheck:
    "Olası etkileri inceledim. Devam etmek yalnız bu yerel uyarıyı kaldırır; komutu iptal etmez veya tekrarlamaz.",
  reviewDone: "İncelemeyi tamamla",
  storageError:
    "Bu sekme kurtarma bilgisini kaydedemedi. Taslağınız görünür kalır; yeni komutlar kapalıdır.",
  storageRetry: "Yerel kaydı yeniden dene",
  damaged:
    "Saklanan terminal verisi bozuk. Yerel kaydı temizlemeden önce önceki komutu inceleyin.",
  localOnly:
    "Taslaklar ve son yanıt, yenileme dahil bu tarayıcı sekmesinde tutulur. Sekmeyi kapatmak bunları silebilir. Telefonunuzla veya başka cihazlarla paylaşılmaz.",
  result: "Kaydedilen komut yanıtı",
  output: "Komut çıktısı",
  emptyOutput: "Çıktı dönmedi.",
  copy: "Çıktıyı kopyala",
  copied: "Kopyalandı",
  copyError: "Kopyalanamadı. Çıktıyı elle seçebilirsiniz.",
  clearOutput: "Görünen çıktıyı temizle",
  reuse: "Komutu taslağa al",
  exit: "Çıkış kodu",
  duration: "Süre",
  latest: "Son sonuç",
  historyHelp:
    "En fazla 6 son yanıt gösterilir; yenileme sonrası kurtarma için yalnız son yanıt saklanır.",
};
export default copy;
