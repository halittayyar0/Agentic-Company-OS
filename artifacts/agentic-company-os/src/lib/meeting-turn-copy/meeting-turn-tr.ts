import type { MeetingTurnCopy } from "../meeting-turn-copy";
const copy: MeetingTurnCopy = {
  outcomeHelp:
    "Bu tur için kaydedilmiş yanıtlar; toplantının güncel görünümü değildir.",
  recordedFailure:
    "Kayıtlı sonuç bir hata bildiriyor. Mevcut yanıtları ve atlanan uzmanları inceleyin.",
  skipped: "Yanıtı kaydedilmeyen uzmanlar",
  skip_busy: "Meşgul",
  skip_unavailable: "Kullanılamıyor",
  skip_empty_response: "Yanıt üretilmedi",
  skip_model_error: "Yanıt üretilemedi",
  skip_provider_unavailable: "Sağlayıcı kullanılamıyor",
  skip_budget_guard: "Yanıt bütçesine ulaşıldı",
  inboxTitle: "Kayıtlı toplantı turları",
  inboxHelp:
    "Bu projedeki istekler, toplantı listede görünmese bile burada bulunur. Kayıtlar bu tarayıcı sekmesine aittir; temizlemek sunucudaki işi iptal etmez.",
  meetingId: "Toplantı kimliği",
  participants: "Kayıtlı katılımcı kimlikleri",
  defaultParticipants: "Kayıtlı istekte belirtilmemiş",
  noParticipants: "Boş katılımcı listesi",
  tokenLimit: "Kayıtlı yanıt token sınırı",
  defaultLimit: "Belirtilmemiş; sunucu varsayılanı",
  damagedTitle: "Bozuk tur kaydı",
  reviewDamaged: "Bozuk kaydı incele",
  damagedHelp:
    "Özgün yerel içerik aşağıda gösteriliyor. Temizlemeden önce gerekli kanıtları kopyala. Bozuk veriden istek gönderilemez.",
  clearDamaged: "İncelenen yerel kaydı temizle",
  clearHelp:
    "Gerekli kanıtları inceledim ve sakladım. Bu yerel kopyayı temizlemek kabul edilmiş turu iptal etmez veya sunucu kayıtlarını silmez.",
  localKey: "Yerel kayıt anahtarı",
  storageReadError:
    "Kayıtlı istekler tam okunamadı. Bu, boş bir liste anlamına gelmez. Tarayıcı depolamasını düzeltip yenile.",
  refreshInbox: "Kayıtları yenile",
  changed:
    "Kayıt değişti veya temizlenemedi. Listeyi yenileyip güncel kaydı incele.",
  previous: "Önceki kayıtlar",
  next: "Sonraki kayıtlar",
  scanMore: "Daha fazla kayıt tara",
  scanIncomplete:
    "Depolama taraması tamamlanmadı. Başka istekler olabilir; bulmak için taramaya devam et.",
  pageSummary: "Bulunan {count} kaydın {from}–{to} arası",
  title: "Toplantı turunu kurtar",
  help: "Özgün istek bu tarayıcı sekmesinde saklanıyor. Sayfayı yenilemek veya kaydı denetlemek yeni tur başlatmaz.",
  prompt: "Saklanan operatör mesajı",
  pending:
    "Yanıt henüz doğrulanmadı. Yeniden göndermeden önce kayıtlı sonucu denetle.",
  check: "Kayıtlı sonucu denetle",
  checking: "Denetleniyor…",
  running: "Kabul edilen tur hâlâ çalışıyor. Daha sonra yeniden denetle.",
  notRecorded:
    "Kayıt bulunamadı. Aynı istek kimliği ve özgün içerikle açıkça yeniden deneyebilirsin.",
  retry: "Özgün isteği yeniden dene",
  recorded:
    "Tur sona erdi ve sonucu kaydedildi. Devam etmeden önce toplantı tutanağını incele.",
  unconfirmed:
    "Kabul edilen turun sonucu belirsiz. Aynı kimlik tekrar çalıştırılmayacak.",
  review: "İncele ve devam et",
  reviewHelp:
    "Bu işlem yalnız yerel işareti kaldırır; sunucudaki işi iptal etmez. Sonuç kaydının bulunmaması, isteğin hiç kabul edilmediğini kanıtlamaz. Yeni tur aynı işi tekrarlayabilir veya model kullanımı doğurabilir; önce saklanan girdiyi ve mevcut toplantı kayıtlarını incele.",
  continue: "Kayıtları inceledim",
  cancel: "Kurtarmayı açık tut",
  storage:
    "Tarayıcı depolaması kullanılamıyor. Kurtarma kimliği saklanana kadar yeni tur gönderilemez.",
  invalid:
    "Saklanan kurtarma kaydı okunamadı. Yeni tur başlatmadan önce bu sekmeyi koru ve depolanan kaydı incele.",
  loadError: "Sonuç kaydı doğrulanamadı. Özgün istek saklanmaya devam ediyor.",
  recordId: "İstek kimliği",
  requestFailed:
    "Tur yanıtı doğrulanmadı. Saklanan sonucu kurtarma panelinden denetle.",
};
export default copy;
