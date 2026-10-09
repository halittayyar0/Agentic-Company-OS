import type { InferenceAccountingCopy } from "../inference-accounting-copy";
export default {
  title: "Model kullanım kayıtları",
  clear: "Belirsiz kullanım kaydı yok",
  pending: "Yanıt süresi henüz dolmadı",
  recovery_required: "Kullanım doğrulanmalı",
  pendingHelp:
    "Bir yanıt hâlâ gelebilir. Bu durum ajanın çalıştığını doğrulamaz.",
  recoveryHelp:
    "Kullanım doğrulanamadı. Bu kapsamdaki yeni model istekleri bekletiliyor. İnceleme için istek kimliğini saklayın. Durum kontrolü isteği yeniden göndermez.",
  clearHelp:
    "Bu kapsamı bekleten belirsiz kullanım kaydı yok. Bu, görevin başarıyla tamamlandığı veya çalıştırma izni verildiği anlamına gelmez.",
  inspect: "Kayıtları kontrol et",
  error: "Güncel durum doğrulanamıyor. Önceden gösterilen kayıtlar korunuyor.",
  observed: "Son kontrol",
  request: "İstek kimliği",
  tokens: "token",
  lowerBound: "Bildirilen en az kullanım",
  complete: "Bildirilen kullanım",
  unknownUsage: "Kullanım bilinmiyor",
  unknownCost: "Maliyet bildirilmedi",
  more: "Son 20 kayıt gösteriliyor; belirsiz kayıtlar önce gelir.",
  states: {
    reserved: "Hazırlandı; gönderilmedi",
    dispatched: "Gönderildi; kullanım kaydı bekleniyor",
    uncertain: "Kullanım doğrulanmadı",
    accounted: "Kullanım kaydedildi",
    not_dispatched: "Gönderilmedi",
  },
} satisfies InferenceAccountingCopy;
