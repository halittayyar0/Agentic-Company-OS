import type { CodingRecoveryCopy } from "../coding-recovery-copy";
export default {
  title: "Kodlama oturumu",
  description:
    "Devam edemeyen, durmuş bir kodlama oturumunu sıfırlayın. Önceki dosyalar ve geçmiş korunur. Görev beklemede kalır; devam etmeden belirsiz işlemleri inceleyin.",
  acknowledge:
    "Görev geçmişini inceledim; belirsiz işlemlerin hâlâ çözümlenmediğini anlıyorum.",
  reset: "Oturumu arşivle ve sıfırla",
  checking: "Oturum kontrol ediliyor…",
  inspect: "Kaydedilmiş sonucu kontrol et",
  retry: "Aynı isteği tekrar gönder",
  missing:
    "Bu istek için henüz kaydedilmiş bir sonuç yok. Aynı isteği tekrar gönderebilirsiniz.",
  unknown:
    "Sıfırlama sonucu doğrulanamadı. Yeni istekten önce kaydedilmiş sonucu kontrol edin.",
  storage:
    "Toparlanma bilgileri bu sekmede güvenle kaydedilemiyor. Yeniden denemeden tarayıcı depolamasını ve görev geçmişini kontrol edin.",
  snapshotError: "Oturum durumu yüklenemedi. Tekrar kontrol edin.",
  success:
    "Oturum arşivlendi. Önceki dosyalar ve kanıtlar korundu. Görev yeniden başlamadı; devam etmeden bekleyen işlemleri inceleyin.",
  reasons: {
    task_missing: "Bu görev artık mevcut değil.",
    session_missing: "Bu görevin sıfırlanacak bir kodlama oturumu yok.",
    revision_changed:
      "Oturum değişti. Yeni istekten önce güncel durumunu kontrol edin.",
    revision_exhausted:
      "Oturum kayıt sürümü güvenle ilerletilemiyor. Sunucu yöneticisinden yardım alın.",
    task_active:
      "Görev hâlâ çalışıyor veya bir çalıştırıcıya atanmış. Durdurup işlemlerin kapanmasını bekleyin.",
    session_running:
      "Kodlama işlemi hâlâ bir çalıştırıcının kontrolünde. Durduğunun doğrulanmasını bekleyin.",
    cleanup_unknown:
      "İşlemin durduğu doğrulanamadı. Yeni işlem başlatmak için güvenli sıfırlama yapılamıyor.",
    native_pending:
      "Bir yerel işlem hâlâ karar veya sonuç bekliyor. Önce onu inceleyin.",
    already_reset:
      "Önceki oturum arşivlendi. Daha sonra yetki verilen bir kodlama görevi yeni oturum açabilir.",
  },
} satisfies CodingRecoveryCopy;
