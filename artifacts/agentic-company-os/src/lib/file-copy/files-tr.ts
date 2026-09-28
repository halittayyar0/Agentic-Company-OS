import type { FileCopy } from "../file-copy";
const copy: FileCopy = {
  filesTitle: "Çalışma dosyaları",
  filesHelp:
    "Dosyalar bu uzmanın projeleri arasında ortaktır. Kaydetmeden önce güncel sürümü inceleyin.",
  root: "Çalışma alanı kökü",
  openFile: "Dosyayı aç",
  openFolder: "Dizini aç",
  newFile: "Yeni dosya",
  refreshFiles: "Dosya listesini yenile",
  loadingFiles: "Dosyalar yükleniyor…",
  listError: "Dizin yüklenemedi.",
  listStale: "Yenileme başarısız. Son yüklenen dizin görünür kalıyor.",
  partialList:
    "Bu liste eksik. En fazla 2.000 öğe incelenir; desteklenmeyen veya okunamayan öğeler gösterilmeyebilir.",
  emptyList: "Bu dizin boş.",
  entriesLabel: "Gösterilen öğeler",
  pathLabel: "Göreli dosya yolu",
  pathHelp:
    "Klasörleri / ile ayırın. Yeni dosya oluşturmak mevcut dosyanın üzerine yazmaz.",
  pathInvalid:
    "En fazla 2.048 karakterlik göreli bir yol girin; boş, . veya .. bölümlerini, ters eğik çizgiyi ve baştaki/sondaki boşlukları kullanmayın.",
  create: "Oluştur",
  fileCreated: "Sunucu dosyanın oluşturulduğunu doğruladı.",
  contentLabel: "{name} içeriği",
  save: "Kaydet",
  close: "Kapat",
  readError: "Dosya okunamadı. Taslağınız korunuyor.",
  reading: "Dosya okunuyor…",
  readonly:
    "Bu yalnızca önizlemedir. Kısaltılmış, ikili veya desteklenmeyen dosyalar burada kaydedilemez.",
  contentInvalid:
    "NUL karakteri içermeyen, en fazla 128 KiB boyutunda geçerli UTF-8 metin kullanın. Taslak kısaltılmadı.",
  snapshotHint:
    "Bir anlık görüntüyü düzenliyorsunuz. Sunucu kaydederken sürümü yeniden kontrol eder.",
  saved: "Sunucu içeriğin kaydedildiğini doğruladı.",
  draftsTitle: "Bu sekmedeki kayıtlı taslaklar",
  resumeDraft: "Taslağa dön",
  discardDraft: "Taslağı sil",
  discardTitle: "Bu yerel taslak silinsin mi?",
  discardBody:
    "Yerel taslak kaldırılır. Bu işlem sunucudaki bir kaydı geri almaz veya iptal etmez.",
  discardConfirm: "Yerel taslağı sil",
  reviewTitle: "Dosya sürümünü incele",
  reviewHelp:
    "Taslağınız korunuyor. Yeniden kaydetmeden önce sunucudaki güncel dosyayı karşılaştırın.",
  compare: "Güncel dosyayı karşılaştır",
  comparisonLabel: "Sunucudaki güncel içerik",
  comparisonError:
    "Güncel dosya okunamadı. Taslak korunuyor; inceleme tamamlanmadı.",
  reviewCheck:
    "Güncel içeriği inceledim. Sonraki kayıt taslağımı bu sürümün yerine yazabilir.",
  reviewDone: "İncelemeyi tamamla",
  writeUnknown: "Kayıt sonucu doğrulanmadı",
  writeUnknownHelp:
    "İstek dosyayı değiştirmiş olabilir. Yerel uyarıyı temizlemeden önce güncel içeriği ve sunucu etkinliğini inceleyin. Temizlemek isteği tekrarlamaz veya iptal etmez.",
  writePending: "İstek gönderildi; dosya yanıtı bekleniyor…",
  reviewRequest: "Önceki kaydı incele",
  missingFile:
    "Dosya şu anda bulunmuyor. Bu, önceki bir isteğin çalışıp çalışmadığını kanıtlamaz.",
  fileStorageError:
    "Bu sekme kurtarma verisini saklayamadı. Ayrılmadan önce görünen taslakları koruyun veya kopyalayın. Yeni kayıtlar engelleniyor.",
  fileDamaged:
    "Kayıtlı dosya verisi bozuk. Yerel veriyi temizlemeden önce önceki etkileri kontrol edin ve görünen taslakları kopyalayın.",
  fileResetCheck:
    "Önceki etkileri kontrol ettim ve gerekli taslakları kopyaladım. Bu sekmenin dosya taslaklarını ve kayıt uyarısını temizle.",
  fileReset: "Yerel dosya verisini temizle",
  fileLocalOnly:
    "Taslaklar ve bekleyen kayıtlar yenilemeler dahil bu tarayıcı sekmesinde tutulur. Sekme kapanınca kaybolabilir; başka cihazlarla paylaşılmaz.",
  fileBlocked: "Güvenlik durumu izin verene kadar dosya değişiklikleri kapalı.",
  title: "Silme kapsamını incele",
  remove: "Sil",
  help: "Listelenen tüm öğeler kalıcı olarak silinecek. Kapsam değişirse yeniden inceleme gerekir. Diğer programların bu dosyaları değiştirmesini durdurun.",
  inspect: "Güncel kapsamı incele",
  inspecting: "İnceleniyor…",
  scope: "Silinecek öğelerin tam listesi",
  count: "Hedef dahil öğe sayısı",
  bytes: "Dosya baytları",
  file: "Dosya",
  folder: "Klasör",
  confirm:
    "Bu kapsamın tamamını inceledim ve silmenin geri alınamayacağını anlıyorum.",
  submit: "İncelenen kapsamı sil",
  pending: "Silme yanıtı bekleniyor…",
  cancel: "Vazgeç",
  success: "Sunucu silme işlemini doğruladı.",
  unknown: "Silme sonucu doğrulanmadı",
  unknownHelp:
    "İstek hedefin bir kısmını veya tamamını silmiş olabilir. Güncel dosyaları ve sunucu etkinliğini inceleyin. Hata alınması içeriğin korunduğu anlamına gelmez.",
  missing:
    "Hedef şu anda bulunmuyor. Bu, kimin sildiğini veya önceki isteğin tamamlandığını kanıtlamaz.",
  error:
    "Kapsam incelenemedi. Bağlantıyı, izinleri ve dosyaların değişmeye devam edip etmediğini kontrol edin.",
  limited:
    "Bu kapsam burada incelenemiyor: bağlantı veya özel dosya içeriyor ya da 1.000 öğe, 64 MiB, 32 seviye veya inceleme süresi sınırını aşıyor olabilir. Sunucudan yönetin.",
  changed: "Kapsam değişti. Silmeyi onaylamadan önce yeniden inceleyin.",
  storageError:
    "Bu sekme kurtarma kaydını saklayamadı. Yeni silme isteği gönderilmeyecek.",
  damaged:
    "Kayıtlı silme verisi bozuk. Bu yerel kaydı temizlemeden önce önceki etkileri inceleyin.",
  clearConfirm:
    "Olası etkileri kontrol ettim. Bu uyarıyı temizlemek sunucudaki isteği iptal etmez veya tekrarlamaz.",
  clear: "Yerel uyarıyı temizle",
  recover: "Önceki silmeyi incele",
  localOnly:
    "Kurtarma kaydı bu tarayıcı sekmesindedir. Sekme kapanınca kaybolabilir; başka cihazlarla paylaşılmaz.",
  storageRetry: "Yerel kaydı yeniden dene",
  blocked: "Güvenlik durumu izin verene kadar silme kullanılamaz.",
  required: "Silmeden önce incelenen kapsamı onaylayın.",
};
export default copy;
