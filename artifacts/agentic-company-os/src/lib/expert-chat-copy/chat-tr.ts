import type { ExpertChatCopy } from "../expert-chat-copy";
export default {
  projectTitle: "Proje konuşması",
  projectHelp:
    "Mesajlar ve yakın geçmiş bu projeye ve koordinatörüne bağlanır. Mevcut araç izinleri ve onay gereklilikleri geçerlidir.",
  projectPrompt: "Bu projenin hedefini incele ve sonraki adımı öner.",
  projectUnavailable:
    "Proje kullanılamıyor veya koordinatörü değişti. Yeni mesaj göndermeden önce projeyi yenile.",
  required: "Bir mesaj yaz.",
  title: "Konuşma",
  help: "Bu uzmana soru sorun veya iş oluşturun. Araç yetkileri ve onaylar geçerliliğini korur.",
  history: "Konuşma geçmişi",
  empty: "Bir konuşma başlatın",
  emptyHelp:
    "Mesajlar sunucuda saklanır. Modele yakın geçmiş verilir; belleği sınırsız değildir.",
  loading: "Mesajlar yükleniyor…",
  historyError: "Konuşma geçmişi yüklenemedi.",
  historyStale: "Geçmiş yenilenemedi. Son yüklenen mesajlar görünür kalıyor.",
  refresh: "Geçmişi yenile",
  older: "Eski mesajları yükle",
  olderError: "Eski mesajlar yüklenemedi. Mevcut görünüm korundu.",
  windowLimit:
    "Aynı anda en fazla 500 mesaj gösterilir. Yeni etkinlikleri izlemek için son mesajlara dönün.",
  latest: "Son mesajlara git",
  newMessages: "Yeni mesajlar var",
  you: "Siz",
  system: "Sistem kaydı",
  model: "Kayıtlı model",
  copy: "Mesajı kopyala",
  copied: "Kopyalandı",
  copyError: "Kopyalanamadı. Kopyalamak için mesaj metnini seçin.",
  unsafeLink: "Güvenli olmayan bağlantı engellendi",
  mode: "İstek türü",
  ask: "Sor",
  delegate: "İş ver",
  continuous: "Sürekli sorumluluk",
  askHelp: "Tek konuşma turu; uzman izin verilen araçları kullanabilir.",
  delegateHelp:
    "Belirli bir sonuç için proje oluşturur. Sıraya alınan iş henüz başlamamış olabilir.",
  continuousHelp:
    "Bir saat aralıkla yinelenen iş oluşturur. Çalışması işçi sürece ve onaylara bağlıdır.",
  instruction: "Mesaj veya iş açıklaması",
  placeholder: "Sorunuzu veya istediğiniz sonucu anlatın…",
  send: "İsteği gönder",
  keyboard: "Enter yeni satır ekler. Ctrl/⌘ + Enter gönderir.",
  tooLong: "Metin, seçilen istek türünün sınırını aşıyor.",
  blocked:
    "Güvenlik durumu izin verene kadar yeni iş duraklatıldı. Yazabilir ve kayıtlı sonuçları okuyabilirsiniz.",
  unavailable:
    "Göndermeden önce uzman ayarlarını yenileyip inceleyin. Arşivlenmiş uzman yeni iş başlatamaz.",
  draftLocal:
    "Gönderilmemiş metin bu tarayıcı sekmesinde tutulur. Sekme kapatılınca kaybolabilir.",
  storageError:
    "Bu sekmenin yerel kaydı saklanamadı veya temizlenemedi. Metninizi kopyalayın; saklama çalışana kadar gönderim kapalı.",
  sending: "Sunucu bekleniyor…",
  unconfirmed: "Sonuç henüz doğrulanmadı",
  unconfirmedHelp:
    "İstek hâlâ çalışıyor veya durmuş olabilir. Kaydı sorgulamak işi yeniden çalıştırmaz.",
  check: "Kayıtlı sonucu kontrol et",
  checking: "Kontrol ediliyor…",
  missing:
    "Henüz kayıtlı sonuç bulunamadı. Yoldaki bir istek sunucuya ulaşabilir.",
  recover: "Aynı isteği kurtar",
  recoverHelp:
    "Özgün kimlik ve ayarları kullanır. Sunucu daha önce kaydetmediyse saklanan isteği bir kez başlatabilir.",
  readError:
    "Kayıtlı sonuç okunamadı. Bu istek kimliğini koruyup tekrar kontrol edin.",
  rejected: "İstek çalışmaya alınmadan reddedildi.",
  configChanged:
    "Uzman ayarları değişti. Yeni istek oluşturmadan önce yenileyip inceleyin.",
  busy: "Uzman zaten çalışıyor. Bu istek çalışmaya alınmadı.",
  capacity:
    "Çalışma alanının kapasitesine ulaşıldı. Yeni istekten önce mevcut işleri inceleyin.",
  invalid: "Sunucu bu isteği kabul edemedi. Özgün metni ve seçimi inceleyin.",
  conflict:
    "Bu kimlik kayıtlı istekle eşleşmiyor. Devam etmeden önce kayıtları inceleyin.",
  receipt: "Gönderim kaydı",
  done: "Yanıt kaydedildi",
  queued: "Proje sıraya alındı",
  systemResult: "Tur bir sistem bildirimiyle sona erdi",
  project: "Projeyi aç",
  operations: "Operations sayfasını aç",
  continue: "Devam et",
  review: "Devam etmeden önce incele",
  reviewHelp:
    "Bu sekmenin bekleyen kaydını temizlemek sunucudaki işi iptal etmez. Yeni bir istek aynı işlemleri tekrarlayabilir. Önce geçmişi, projeleri ve araç kayıtlarını inceleyin.",
  acknowledge:
    "Kayıtları inceledim; yeni isteğin işlemleri tekrarlayabileceğini anlıyorum.",
  cancel: "İptal",
  activity: "Son kayıtlı etkinlikler",
  activityHelp:
    "Bu uzmanın son 12 olayı. Başka işlere ait olabilir; bu isteğin canlı veya tamamlanmış olduğunu kanıtlamaz.",
  activityEmpty: "Yakın zamanda kaydedilmiş etkinlik yok.",
  activityError: "Etkinlikler yenilenemedi. Görünen kayıtlar eski olabilir.",
  source: "Özgün kayıt metni",
  prompt: "Rolünü, yeteneklerini ve sınırlarını açıkla.",
} satisfies ExpertChatCopy;
