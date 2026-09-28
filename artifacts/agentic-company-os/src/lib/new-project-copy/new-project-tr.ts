import type { NewProjectCopy } from "../new-project-copy";

const copy = {
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
