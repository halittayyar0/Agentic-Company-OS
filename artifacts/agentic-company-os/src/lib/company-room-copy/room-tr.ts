import type { CompanyRoomCopy } from "../company-room-copy";
export default {
  title: "Şirket odası",
  eyebrow: "Ortak hafıza",
  description:
    "Ekibin için kalıcı bir konuşma. Üyeleri yönet, uzmanları etiketle ve kararları bir arada tut.",
  members: "Oda üyeleri",
  memberRegion: "Şirket odası üyeleri",
  activeMembers: "Aktif üyeler",
  rosterHelp:
    "Üyelik ve yanıt bütçesi ayrıdır. Ajanlar meşgul olabilir veya katkısı yoksa yanıt vermeyebilir.",
  openChat: "Uzman sohbeti aç",
  join: "Odaya ekle",
  leave: "Odadan çıkar",
  inactive: "Pasif",
  memberAdded: "Üye eklendi",
  memberRemoved: "Üye çıkarıldı",
  memberError:
    "Üyelik değişikliği doğrulanamadı. Yeniden denemeden önce listeyi yenile.",
  rosterError: "Üye listesi alınamadı.",
  rosterStale:
    "Üyeler yenilenemedi. Gönderim ve üyelik değişiklikleri duraklatıldı.",
  noAgents: "Kullanılabilir uzman yok",
  noMembers: "Henüz üye yok",
  loadingMembers: "Oda üyeleri yükleniyor",
  loadingMessages: "Şirket odası mesajları yükleniyor",
  messagesError: "Şirket odası yüklenemedi.",
  messagesStale: "Son yüklenen konuşma gösteriliyor. Göndermeden önce yenile.",
  empty: "Şirket odası henüz sessiz",
  emptyHelp:
    "Bir mesaj yaz veya üyeyi @ ile çağır. Mesajlar kayıtlı gönderen kimliğini korur.",
  firstMessage: "İlk mesajı yaz",
  retry: "Yenile",
  older: "Eski mesajları yükle",
  newMessages: "Son mesajlara git",
  loadedMessages: "Yüklenen mesajlar",
  founder: "Operatör",
  agent: "Uzman",
  roomReply: "Oda yanıtı",
  projectNote: "Proje notu",
  operatorMessage: "Operatör mesajı",
  project: "Proje",
  source: "Mesajlar ve özel kimlikler özgün dilinde kalır.",
  skipped: "Yanıt durumu",
  busy: "başka bir işle meşgul",
  unavailable: "erişilemiyor",
  empty_response: "yanıt üretmedi",
  model_error: "yanıtı üretilemedi",
  not_relevant: "katkısı olmadığı için yanıtlamadı",
  not_mentioned: "etiketlenmedi",
  budget_guard: "yanıt bütçesi nedeniyle atlandı",
  close: "Kapat",
  compose: "Şirket odasına mesaj",
  placeholder: "Mesaj yaz; bir üyeyi çağırmak için @ kullan",
  send: "Şirket odasına gönder",
  sending: "Mesaj kaydediliyor, yanıtlar bekleniyor…",
  mentionMembers: "Etiketlenecek oda üyeleri",
  removeMention: "Etiketi kaldır",
  noMatches: "Eşleşen aktif oda üyesi yok",
  mentionedHelp:
    "Yanıt için yalnız etiketlediğin aktif üyeler değerlendirilir.",
  ambientHelp:
    "Etiket yoksa oda üyeleri mesajı değerlendirir; yalnız katkısı olanlar yanıt verir.",
  invalidMention:
    "Etiketlenen üye ayrıldı veya kimliği değişti. Göndermeden önce taslağı gözden geçir.",
  stored: "Mesaj kaydedildi",
  storedHelp: "Sınırlı yanıt turu bitti. Atlanan üyeler yanıt vermedi.",
  unconfirmed:
    "Mesajın kaydedildi; tüm yanıtlar doğrulanamadı. Canlı konuşmayı kontrol et. Kurtarma işlemi turu yeniden başlatmaz.",
  unknown:
    "Gönderimin sonucu belirsiz. Başka mesaj yazmadan önce bu gönderimi kurtar.",
  recover: "Gönderimi kurtar",
  storageError:
    "Tarayıcı kurtarma bilgisini saklayamadı. Oturum depolamasında yer açıp tekrar dene.",
  conflict:
    "Bu gönderim kimliği farklı içeriğe ait. Taslağını koru ve yeni gönderimden önce odayı kontrol et.",
  invalid: "İstek reddedildi. Mesajı ve üyeleri gözden geçir.",
  capacity: "Odanın mesaj sınırına ulaşıldı.",
  stopped:
    "Acil durdurma etkin. Yeni mesajlar duraklatıldı; mevcut gönderimler kurtarılabilir.",
  safetyUnknown: "Güvenlik durumu denetlenemedi. Yeni mesajlar duraklatıldı.",
  pendingHelp:
    "Kurtarılmayı bekleyen bir gönderim var. Metni, alıcıları ve dili sabit tutuluyor.",
  newSend: "Başka mesaj yaz",
} satisfies CompanyRoomCopy;
