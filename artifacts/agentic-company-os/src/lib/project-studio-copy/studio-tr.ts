import type { ProjectStudioCopy } from "../project-studio-copy";
const copy: ProjectStudioCopy = {
  budgetHeading: "Kullanım sınırı nedeniyle duraklatıldı",
  budgetHelp:
    "Bu kontrol model kullanmaz ve kullanımı sıfırlamaz. Devam eden işler mevcut kullanım sınırına tabidir. Sınır doluysa yapılandırmadaki sınırı artırın veya günlük pencerenin yenilenmesini bekleyin.",
  budgetGuide: "Kullanım sınırları rehberi",
  budgetCheck: "Kullanım sınırını kontrol et ve devam ettir",
  budgetChecking: "Kontrol ediliyor…",
  budgetAccepted: "{count} iş devam etmek üzere sıraya alındı.",
  budgetStillPaused: "{count} iş duraklatılmış olarak kaldı.",
  budgetUnknown:
    "İşlemin sonucu doğrulanamadı. Yeni bir istek göndermeden önce kaydedilen işlem kaydını kontrol edin.",
  budgetInspect: "İşlem kaydını kontrol et",
  budgetMissing:
    "Henüz kaydedilmiş bir işlem bulunamadı. İstek hâlâ işleniyor olabilir; aynı isteği güvenle yeniden gönderebilirsiniz.",
  budgetRetry: "Aynı isteği yeniden gönder",
  budgetStorage:
    "Kurtarma bilgileri bu sekmede saklanamadı. Hiçbir istek gönderilmedi veya doğrulanmış işlemin bilgileri silinemedi. Tarayıcı depolamasını açıp işlem kaydını kontrol edin.",
  budgetSnapshotError: "Güncel iş kapsamı alınamadı. Tekrar kontrol edin.",
  budgetLoadError:
    "Devam ettirme kontrolü yüklenemedi. Sayfayı yenileyin; kaydedilmiş istek korunur.",
  budgetReasonEmergency:
    "Acil durdurma etkin. Kaldırıldıktan sonra tekrar kontrol edin.",
  budgetReasonChanged:
    "İş veya ana iş kapsamı değişti. Güncel durumu kontrol edin.",
  budgetReasonInvalid:
    "Bu işin geçerli bir ana iş kapsamı yok. Devam ettirilmedi.",
  budgetReasonLarge:
    "Bu iş ailesi 1.000 iş sınırını aşıyor. Hiçbir iş devam ettirilmedi.",
  budgetReasonExhausted:
    "Kullanım sınırı hâlâ dolu. Sınırı artırdıktan veya günlük pencere yenilendikten sonra tekrar kontrol edin.",
  budgetReasonIneligible:
    "Şu anda güvenle devam ettirilebilecek bir iş yok. İşlerin sorumlularını, izinlerini ve devam eden işlemleri kontrol edin.",
  answerHeading: "{name} senden yanıt bekliyor",
  answerHelp:
    "Soruyu gözden geçir. Yanıtını gönderdiğinde görev devam etmek üzere sıraya alınır.",
  answerLabel: "Ajana yanıtın",
  answerPlaceholder: "Kararını veya eksik bilgiyi yaz…",
  answerDraft:
    "Taslağın sayfa yenilendiğinde bu tarayıcı sekmesinde korunur. Kimlik bilgisi paylaşma.",
  answerRequired: "Bir yanıt yaz.",
  answerLong: "En fazla 1.200 karakter kullan.",
  answerSend: "Yanıtı gönder ve devam ettir",
  answerSending: "Yanıt iletiliyor…",
  answerAccepted: "Yanıt kaydedildi. Görev devam etmek üzere sıraya alındı.",
  answerUnknown:
    "Gönderimin sonucu doğrulanamadı. Metnin burada duruyor; devam etmeden önce kayıtlı sonucu kontrol et.",
  answerCheck: "Gönderimi kontrol et",
  answerNotRecorded:
    "Henüz kayıtlı sonuç bulunamadı. İstek işleniyor olabilir. Aynı yanıtı güvenle yeniden deneyebilirsin.",
  answerRetry: "Aynı yanıtı yeniden dene",
  answerStorage:
    "Kurtarma bilgileri bu sekmeye kaydedilemedi. Hiçbir şey gönderilmedi. Yanıtının bir kopyasını al ve tarayıcı depolamasını etkinleştir.",
  answerUnavailable:
    "Bu görevde şu anda yanıtlanabilir bir soru yok. Yenileyerek tekrar kontrol et.",
  answerChanged:
    "Soru değişti. Taslağın korunuyor. Güncel soruyu aç ve göndermeden önce yanıtını gözden geçir.",
  answerReview: "Güncel soruyu aç",
  answerRejected: "Sunucu bu yanıtı kabul etmedi.",
  answerTaskChanged:
    "Görev veya sorumlu ajan değişti. Devam etmeden önce yenile.",
  answerOwnerInactive: "Sorumlu ajan etkin değil.",
  answerEmergency: "Acil durdurma etkin. Kaldırıldıktan sonra yenile.",
  answerQuestionLabel: "Kayıtlı soru",
  answerQuestionError: "Soru yüklenemedi. Taslağın korunuyor.",
  answerPendingHelp:
    "Kaydedilen yanıtın gönderim sonucu netleşene kadar metin kilitli. Kontrol etmek yeniden göndermez.",
  unavailable: "Alınamadı",
  recordsMissing: "Faaliyet kayıtları yüklenemedi.",
  tasksMissing: "Alt işler yüklenemedi.",
  tasksLoading: "Alt işler yükleniyor…",
  tasksStale: "Alt işler yenilenemedi. Son alınan liste gösteriliyor.",
  completedWork: "Gösterilen alt işlerden tamamlananlar",
  recordStatus: "Kayıtlı durum",
  invalidTitle: "Geçersiz proje adresi",
  invalidHelp: "Bu bağlantıda kullanılabilir bir proje kimliği yok.",
  missingTitle: "Proje bulunamadı",
  missingHelp:
    "#{id} numaralı proje silinmiş veya hiç oluşturulmamış olabilir.",
  loadError: "Proje yüklenemedi",
  loadHelp: "Proje bilgileri alınırken bağlantı hatası oluştu.",
  stale:
    "Yenileme başarısız. Son alınan proje gösteriliyor; yeni işlemler için güncel durumu kontrol et.",
  snapshot: "Son alınma: {time}",
  retry: "Yeniden dene",
  back: "Projelere dön",
  parent: "Ana proje",
  operations: "Operasyon odası",
  stop: "Durdur",
  stopTitle: "Çalışma durdurulsun mu?",
  stopHelp:
    "“{title}” ve etkin alt çalışmalar durdurulur. Tamamlanmış dış etkiler geri alınmaz; kayıtlar korunur.",
  dismiss: "Vazgeç",
  confirmStop: "Çalışmayı durdur",
  stopping: "Durdurma sonucu bekleniyor…",
  stopped: "Durdurma kaydedildi",
  unknownStop: "Durdurma sonucu doğrulanamadı",
  unknownHelp:
    "İstek sunucuya ulaşmış olabilir. Durumu kontrol etmek yeni bir durdurma isteği göndermez.",
  checkState: "Durumu kontrol et",
  checking: "Kontrol ediliyor…",
  activeAfterCheck:
    "Son kontrolde çalışma hâlâ etkin. Önceki isteğin sonucu bilinmiyor. Yeni durdurmayı ayrıca onaylayabilirsin.",
  reviewStop: "Durdurmayı yeniden incele",
  terminalObserved:
    "Sunucudaki durum: {status}. Bu kontrol önceki isteğin sonucunu tek başına kanıtlamaz.",
  storageError:
    "Durdurma kaydı bu sekmede saklanamadı; istek gönderilmedi. Tarayıcı depolamasını kontrol et.",
  continuous: "Sürekli · {count} döngü",
  finite: "Sonlu çalışma",
  mode: "{name} modu",
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
  warning: "Son çalışma uyarısı",
  source: "Özgün kayıt metni",
  nextAttempt: "Sonraki deneme: {time}",
  partial: "Bazı proje bilgileri alınamadı: {sections}.",
  plan: "İş planı",
  experts: "Uzman listesi",
  team: "Proje ekibi",
  chatMissing: "Proje konuşması açılamadı",
  ownerMissing:
    "Sorumlu uzman doğrulanamadı. Güncel proje ve ekip bilgilerini kontrol et.",
  members: "{count} kişilik ekip",
  memberLabel: "Proje ekibi üyeleri",
  emptyTeam: "Ekip bilgisi henüz görünmüyor.",
  coordinatorHelp: "{name} koordinasyonu yürütüyor; çalışma tüm ekibe açık.",
  loading: "Proje stüdyosu yükleniyor",
  tabs: "Proje çalışma alanı görünümleri",
  workspace: "Çalışma alanı",
  planTab: "Plan ve iz",
  meetings: "Toplantılar",
  teamTab: "Ekip",
  evidence: "Teslim",
  rosterHelp: "Bu projenin kayıtlı kadrosu",
  coordinator: "Koordinatör",
  workCount: "{count} iş",
  inTeam: "Ekipte",
  inactive: "Pasif",
  planHelp: "Kayıtlı alt görevler ve son alınan durumları",
  steps: "{count} adım",
  noTasks: "Henüz alt görev yok",
  noTasksHelp: "Uzman planı görevler halinde kaydettiğinde burada görünecek.",
  expertId: "Uzman #{id}",
  records: "Faaliyet kayıtları",
  recordsHelp:
    "Sunucuda kaydedilen son {count} faaliyet. Bu pencere tüm geçmişi içermeyebilir.",
  recordsLoading: "Kayıtlar yükleniyor",
  recordsError: "Faaliyetler yenilenemedi. Son alınan kayıtlar korunuyor.",
  noRecords: "Henüz çalışma kaydı yok",
  runSummary: "Kayıt özeti",
  progress: "İlerleme",
  attempts: "Çalışma turu",
  tokens: "Token",
  model: "Kaydedilen model",
  unknownModel: "Model kaydı yok",
  deliveryHelp:
    "Bu, ajanın kaydettiği teslim özetidir. Doğrulama kayıtlarını {tab} sekmesinden inceleyebilirsin.",
  reviewDelivery: "Kanıtları incele",
  cycleDeliveryNote:
    "Bu, son kaydedilen döngünün özetidir. Düzenli sorumluluğun güncel durumu yukarıda gösterilir.",
  deliverySummary: "Teslim özeti",
  noDelivery: "Henüz kayıtlı teslim özeti yok. Kaydedildiğinde burada görünür.",
};
export default copy;
