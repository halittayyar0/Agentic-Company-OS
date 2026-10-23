import type { TaskResultReviewCopy } from "../task-result-review-copy";
export default {
  title: "İncelemen için önerilen sonuç",
  help: "Otomatik denetçi bu öneriyi reddetti. Onaylamadan önce tam sonucu incele. Onay bu görevi veya döngüyü tamamlar, dış işlem yapmaz ve zorunlu işlemleri kaldırmaz.",
  loading: "Önerilen sonuç yükleniyor",
  unavailable: "Güncel öneri doğrulanamadı. Karar vermeden önce yenile.",
  auth: "Bu sonucu incelemek için anahtarla kimlik doğrulama açık olmalı ve oturum açmalısın.",
  refresh: "İncelemeyi yenile",
  acknowledge: "Bu tam önerilen sonucu inceledim ve onaylamak istiyorum.",
  confirm: "Sonucu onayla",
  reject: "Sonucu reddet",
  confirmed: "Sonuç operatör tarafından onaylandı",
  rejected: "Sonuç reddedildi; görev engellenmiş kalıyor.",
  error:
    "Kararın sonucu doğrulanamadı. Yeniden karar vermeden önce incelemeyi ve talepleri yenile.",
  safety:
    "Güvenlik durumu doğrulanana ve acil durdurma kapanana kadar onay bekliyor.",
  digest: "Öneri özeti",
  cycle: "Döngü",
  expires: "Son geçerlilik",
  requirements: "Zorunlu işlemler",
  satisfied: "Doğrulanmış başarılı işlem kaydı",
  source_mismatch: "Önerilen sonuç okunan kaynakla uyuşmuyor.",
  missing_required_action: "Denetçi açıkça istenen bir işlemi doğrulayamadı.",
  unauthorized_action: "Denetçi izin verilen kapsamı aşan bir işlem belirledi.",
  insufficient_evidence: "Denetçi tamamlama için kanıtı yetersiz buldu.",
  provenance: "Operatör onayladı",
  provenanceHelp:
    "Bu sonuç bir operatör tarafından onaylandı. Otomatik denetçi tarafından kabul edilmedi.",
} satisfies TaskResultReviewCopy;
