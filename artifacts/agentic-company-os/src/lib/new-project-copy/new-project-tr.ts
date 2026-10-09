import type { NewProjectCopy } from "../new-project-copy";

const copy = {
  recovery: {
    title: "Proje başlatma isteğini bul",
    uncertain:
      "Yanıt doğrulanamadı. Başka bir proje başlatmadan önce kaydedilen bu isteği kontrol et.",
    missing:
      "Henüz kayıtlı bir sonuç bulunamadı. İlk istek hâlâ ulaşabilir; yeniden deneme aynı isteği kullanır.",
    created:
      "Proje çalışma alanın oluşturuldu. İşin güncel durumunu görmek için aç.",
    rejected:
      "Bu istek reddedildi. Nedeni giderdikten sonra yeni bir başlangıç hazırla; taslağın burada kalır.",
    checking: "İstek kontrol ediliyor…",
    check: "İsteği kontrol et",
    open: "Projeyi aç",
    retry: "Aynı isteği yeniden dene",
    prepare: "Yeni başlangıç hazırla",
    stored: "Gönderilen proje",
    storageError:
      "Bu sekme kaydedilen isteği doğrulayamadı. Taslağının bir kopyasını sakla. İstek kaydedilemeden yeni istek gönderilmez; bozuk kayıt bu sekmede kurtarılmalıdır.",
    noTokens:
      "Kontrol yalnızca kaydedilen sonucu okur. Model tokenı harcamaz ve işi tekrar çalıştırmaz.",
    reasons: {
      EMERGENCY_STOP_ACTIVE: "Acil durdurma etkin.",
      AGENT_UNAVAILABLE: "Gerekli etkin ekip kullanılamıyordu.",
      RUNTIME_CAPACITY_EXCEEDED:
        "Çalışma alanının eşzamanlı iş sınırına ulaşıldı.",
      EXECUTION_POLICY_DENIED: "Çalıştırma politikası bu başlangıcı engelledi.",
    },
  },
  draftStorageError:
    "Bu sekme taslağı sayfa yenileme için kaydedemiyor. Metninizi burada düzenleyebilirsiniz; sayfayı yenilemeden veya sekmeyi kapatmadan önce bir kopyasını alın.",
  back: "Projelere dön",
  eyebrow: "Yeni proje · tüm ekip",
  title: "Fikri içeri al. Ekibin birlikte hayata geçirsin.",
  teamDescription: (count) =>
    `Tek bir sorumlu seçmiyorsun. ${count || "Tüm"} aktif uzman aynı proje bağlamına katılır; yalnızca ihtiyaç olduğunda devreye girer.`,
  teamUnavailable: "Aktif ekip alınamadı; proje başlatma durduruldu.",
  retry: "Yeniden dene",
  projectName: "Proje adı",
  namePlaceholder: "Örn. Müşteri içgörü platformu",
  brief: "Hedef ve kapsam",
  briefPlaceholder:
    "Ne yapmak istiyorsun? Başarı ölçütlerini, elindeki bağlamı ve teslim edilmesini beklediğin sonucu anlat…",
  projectType: "Proje biçimi",
  finite: "Teslim odaklı",
  continuous: "Sürekli",
  priority: "Proje önceliği",
  priorities: {
    low: "Düşük",
    normal: "Normal",
    high: "Yüksek",
    urgent: "Acil",
  },
  starting: "Ekip ekleniyor…",
  start: "Projeyi başlat",
  cadence: "Çalışma ritmi",
  cadences: {
    900: "15 dakikada bir",
    3600: "Her saat",
    21600: "6 saatte bir",
    86400: "Her gün",
    604800: "Her hafta",
  },
  contextNote:
    "Tüm aktif uzmanlar, toplantılar ve üretim kayıtları bu proje içinde kalır.",
  emergencyStop:
    "Acil durdurma etkin; yeni proje başlatılamaz. Taslağın bu ekranda korunuyor.",
  safetyUnverified:
    "Güvenlik durumu doğrulanana kadar yeni proje başlatılamaz.",
  teamLoading: "Ekip yükleniyor",
  teamAria: (count) => `${count} aktif uzmandan oluşan proje ekibi`,
  validationTitle: "Projenin yönü eksik",
  validationDescription: "Proje adını ve ulaşmak istediğin sonucu yaz.",
  noTeamTitle: "Aktif ekip bulunamadı",
  noTeamDescription: "Projeyi başlatmadan önce en az bir uzmanı etkinleştir.",
  successTitle: "Proje alanı kuruldu",
  successDescription: (id) =>
    `Proje #${id} oluşturuldu; etkin uzmanlar eklendi.`,
  failureTitle: "Proje başlatılamadı",
  failureDescription:
    "Bağlantıyı ve yetkileri kontrol edip yeniden dene. Taslağın bu ekranda korunuyor.",
} satisfies NewProjectCopy;

export default copy;
