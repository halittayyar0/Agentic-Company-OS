import type { ApprovalCopy } from "../approval-copy";
export default {
  emptyPage: "Bu sayfada talep yok",
  closedPreview: "Kapanmış yetkilerde komut önizlemesi gösterilmez.",
  eyebrow: "İnsan kontrolü",
  title: "Onay gelen kutusu",
  description:
    "Ajanların yapmak istediği işlemleri incele. Karar vermeden önce tam kapsamı kontrol et.",
  pending: "Bekleyenler",
  approved: "Onaylananlar",
  rejected: "Reddedilenler",
  spend: "Harcama",
  delete: "Silme",
  publish: "Yayınlama",
  external_contact: "Dış iletişim",
  other: "Diğer",
  shown: "Gösterilen talepler",
  newer: "Daha yeni talepler",
  older: "Daha eski talepler",
  retry: "Talepleri yenile",
  loading: "Onay talepleri yükleniyor",
  loadError: "Onay talepleri yüklenemedi.",
  stale:
    "Talepler yenilenemedi. Güncel durum kontrol edilene kadar karar verme durduruldu.",
  emptyPending: "Bekleyen talep yok",
  emptyPendingHelp: "Kararını bekleyen yeni talepler burada görünecek.",
  emptyApproved: "Onaylanan talep yok",
  emptyApprovedHelp:
    "Onaylanan talepler burada listelenir. Onay verilmesi, işlemin çalıştığını doğrulamaz.",
  emptyRejected: "Reddedilen talep yok",
  emptyRejectedHelp: "Reddedilen ve süresi dolan talepler burada listelenir.",
  requester: "Talep eden",
  unknownRequester: "Uzman",
  task: "Görevi aç",
  note: "Karar notu",
  notePlaceholder: "İsteğe bağlı not, en fazla 2.000 karakter",
  approve: "Onayla",
  reject: "Reddet",
  saving: "Karar kaydediliyor…",
  approvedSaved: "Onay kaydedildi",
  rejectedSaved: "Ret kararı kaydedildi",
  approvedHelp:
    "İşlemin çalıştığı henüz doğrulanmadı. Sonucu bağlantılı görevden takip et.",
  rejectedHelp: "Görev, sonraki talimata kadar engellendi.",
  safetyStopped:
    "Acil durdurma etkin. Talepleri reddedebilirsin; onay verme bekletiliyor.",
  safetyUnknown:
    "Güvenlik durumu doğrulanamadı. Talepleri reddedebilirsin; onay verme bekletiliyor.",
  scope: "Yalnızca bu işlem için tek kullanımlık yetki",
  tool: "Araç",
  target: "Hedef",
  hash: "Komut özeti (hash)",
  preview: "Tam önizleme",
  expires: "Son kullanım",
  consumed: "Yetki kullanıldı",
  consumedHelp:
    "Yetkinin kullanılması işlemin başarılı olduğunu doğrulamaz. Görevi kontrol et.",
  expired: "Süresi doldu",
  noExpiry: "Son kullanım belirtilmedi",
  unscoped:
    "Bu talep kararını kaydeder. Yeniden kullanılabilir araç yetkisi vermez.",
  source: "Talep metni ajan tarafından sağlandı.",
  missingScope:
    "Tam kapsam, önizleme veya son kullanım eksik ya da geçersiz. Yeni onay talebi iste.",
  hostTitle: "Ana bilgisayarda kabuk komutu",
  hostCategory: "Ana bilgisayar erişimi",
  hostWarning:
    "Bu komut, ajan çalışma alanı dışında API servisinin işletim sistemi hesabıyla çalışır.",
  hostDetails:
    "Windows UAC veya Unix yetki yükseltmesi yapmaz. Bu hesabın eriştiği dosyaları, programları ve süreçleri etkileyebilir. Aşağıdaki sunucu kaynaklı komutu ve hedefi incele.",
  hostConfirm: "Ana bilgisayar komutunu doğrula",
  confirmInstruction: "Aşağıdaki komut özetinin ilk 8 karakterini yaz.",
  confirmInput: "Komut özetinin ilk 8 karakteri",
  confirmSubmit: "Ana bilgisayar komutunu onayla",
  cancel: "Vazgeç",
  unknownError:
    "Kararın sonucu doğrulanamadı. Yeniden karar vermeden önce talepleri yenile.",
  changedError:
    "Bu talep değişti veya daha önce karara bağlandı. Karar vermeden önce yenile.",
  expiredError: "Bu yetkinin süresi doldu. Ajandan yeni talep iste.",
  confirmationError: "Komut özeti eşleşmedi. Güncel talebi incele.",
  inputError: "Karar kabul edilemedi. Notunu kontrol edip talebi yenile.",
} satisfies ApprovalCopy;
