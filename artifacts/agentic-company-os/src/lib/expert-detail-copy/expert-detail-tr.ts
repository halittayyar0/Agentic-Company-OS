import type { ExpertDetailCopy } from "../expert-detail-copy";
const copy: ExpertDetailCopy = {
  managedPrompt:
    "Bu hazır rolün talimatları çalışma alanının dilini izler. Düzenleyip kaydettiğinde özel talimat olur; sonraki dil değişimleri metnini değiştirmez.",
  promptRequired: "Kaydetmeden önce çalışma talimatı yaz.",
  invalid: "Geçersiz uzman adresi",
  missing: "Uzman bulunamadı",
  loadError: "Uzman yüklenemedi",
  loadHelp:
    "Kayıt şu anda kullanılamıyor veya artık mevcut değil. Kadroya dön veya yeniden dene.",
  loading: "Uzman yükleniyor…",
  refresh: "Kaydı yenile",
  stale:
    "Son alınan kayıt gösteriliyor. Ayar değiştirmeden önce başarıyla yenile.",
  created: "Oluşturulma",
  lastSeen: "Son bildirilen etkinlik",
  noSignal: "Bildirim yok",
  noStep: "Güncel adım bildirilmedi",
  nextModel: "Kayıtlı çalışma modeli",
  changeModel: "Modeli değiştir",
  modelHelp:
    "Bu seçim, sonraki tur modelini seçerken uygulanır. Devam eden isteği değiştirmez veya sağlayıcı erişimini garanti etmez.",
  save: "Değişiklikleri kaydet",
  saving: "Kaydediliyor…",
  saved: "Sunucu değişikliği doğruladı.",
  unknown:
    "Sonuç doğrulanamadı; değişiklik kaydedilmiş olabilir. Yeniden göndermeden önce yenile ve incele.",
  changed:
    "Uzmanın ayarları başka bir yerde değişti. Kaydetmeden önce son değerleri yenileyip incele.",
  busyError:
    "Uzmanın devam eden bir turu varken yetkiler değiştirilemez. Tamamlanmasını bekle, ardından yenile.",
  capacity:
    "Aktif uzman sınırı dolu. Bu uzmanı geri almadan önce kadroyu incele.",
  denied:
    "Sunucu bu değişikliği reddetti. Yenile ve uzmanın yetkileriyle model seçimini incele.",
  review: "Son değerleri incele",
  discard: "Kayıtlı talimatı kullan",
  source: "Özgün kayıt içeriği",
  promptHelp:
    "Talimatlar uzmanın davranışına yön verir; araç yetkisi sağlamaz. Taslak, kaydedene veya sayfadan ayrılana kadar burada kalır.",
  promptChanged:
    "Sen düzenlerken kayıtlı talimat değişti. Taslağın korundu. Kaydetmeden önce sunucudaki sürümle karşılaştır.",
  permissionsHelp:
    "Bunlar kayıtlı yetkilerdir. Çalışma kuralları ve gerekli insan onayları geçerliliğini korur. Devam eden tur sırasında yetkiler değiştirilemez.",
  enabled: "Açık",
  disabled: "Kapalı",
  hostShell: "Kök CEO host shell",
  hostHelp:
    "Host komutu yine birebir, tek kullanımlık insan onayı ve sunucudaki çalıştırma ayarını gerektirir. İzolasyon veya yetki yükseltmesi olmadan hizmet hesabının mevcut işletim sistemi yetkileriyle çalışır.",
  archive: "Uzmanı arşivle",
  archiveTitle: "Bu uzman arşivlensin mi?",
  archiveHelp:
    "Uzman aktif kadrodan çıkar, açık işleri bloke edilir ve bu işlerin kullanılmamış onay yetkileri kapatılır. Kayıtları korunur. Onaylı bir işlem hâlen yürütülüyorsa sonucu kaydedilene kadar arşivleme yapılamaz.",
  restore: "Uzmanı geri al",
  restoreHelp:
    "Geri alma, uzmanı aktif kadroya döndürür. Önceden bloke edilen görevler otomatik sürdürülmez.",
  cancel: "Vazgeç",
  active: "Aktif kadroda",
  archived: "Arşivde",
  chat: "Sohbet",
  computer: "Bilgisayar",
  tasks: "Görevler",
  stats: "İstatistik",
  settings: "Ayarlar",
  taskLoading: "Atanan görevler yükleniyor…",
  taskError: "Atanan görevler yüklenemedi.",
  taskEmpty: "Bu uzmana atanmış görev yok.",
  taskWindow:
    "En güncel 200 atanmış görev gösterilir. Daha eski kayıtlar bulunabilir.",
  progress: "İlerleme",
  low: "Düşük",
  normal: "Normal",
  high: "Yüksek",
  urgent: "Acil",
  statsWindow:
    "Bu örneklem en fazla son 200 etkinlik ve 200 mesajı kullanır. Bunlar yaşam boyu toplam, başarılı işlem sayısı veya maliyet kaydı değildir.",
  statsError: "İstatistik kaynakları alınamadı. Eksik veri sıfır sayılmaz.",
  replies: "Örneklemdeki ajan yanıtları",
  toolEvents: "Terminal ve dosya olayları",
  createdTasks: "Görev oluşturma olayları",
  delegations: "Görev devri olayları",
  reviews: "Denetim olayları",
  approvalRequests: "Onay talepleri",
  modelUsage: "Kaydedilen modeller",
  modelUsageHelp:
    "En çok görünen beş model; her çubuk örneklemdeki ajan yanıtları içindeki payını gösterir.",
  noModels: "Bu yanıtlarda model kimliği kaydedilmemiş.",
  recentTools: "Son terminal ve dosya olayları",
  noTools: "Bu örneklemde terminal veya dosya olayı yok.",
  oldest: "Örneklemdeki en eski olay",
  records: "İncelenen etkinlikler",
  avatar: "Portre",
  avatarBuiltin: "Yerleşik maskot",
  avatarCustom: "Özel görsel",
  avatarHelp:
    "PNG, JPEG veya WebP, en fazla 5 MB. Tarayıcı yerelde kırpıp sıkıştırır, ardından en fazla 64 KB kopyayı kendi sunucuna kaydeder. Özgün dosya bir görsel servisine gönderilmez.",
  chooseImage: "Görsel seç",
  processing: "Hazırlanıyor…",
  preview: "Kaydedilmemiş önizleme",
  resetAvatar: "Yerleşik maskotu kullan",
  saveAvatar: "Portreyi kaydet",
  avatarFileError:
    "En fazla 5 MB olan, boş olmayan bir PNG, JPEG veya WebP dosyası seç.",
  avatarPrepareError:
    "Görsel hazırlanamadı. Daha küçük, geçerli bir görsel dene; çözünürlük sınırı 40 megapikseldir.",
  avatarChanged:
    "Kayıtlı portre değişti. Önizlemen korundu; kaydetmeden önce yenile ve incele.",
  configuration: "Kayıtlı yapılandırma",
  configHelp:
    "Rol talimatları niyeti açıklar. Aşağıdaki yetkiler, sunucu kuralları ve onaylarla birlikte erişimi belirler. Bu ekran çalışma sağlığını veya host izolasyonunu ölçmez.",
  serverPrompt: "Son kayıtlı talimatı görüntüle",
  busyArchive:
    "Onaylı bir işlem devam ediyor. Arşivlemeden önce sonucunun kaydedilmesini bekle.",
  readonly: "Sunucu ayar sürümü sağlamadı. Düzenlemeden önce yenile.",
  actionTitle: "Yetki",
  taskMore: "Tüm projeleri aç",
};
export default copy;
