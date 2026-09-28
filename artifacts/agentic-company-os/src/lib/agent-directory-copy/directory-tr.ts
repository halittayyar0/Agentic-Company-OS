import { DEPARTMENT_LABELS } from "../agent-presentation";
import type { AgentDirectoryCopy } from "../agent-directory-copy";

const copy = {
  eyebrow: "Ekibini tanı",
  title: "İşin için doğru uzman.",
  description:
    "Kim ne yapar, hangi işte yardımcı olur? Uzmanları tanı, konuşmaya başla veya ekibine yeni bir rol ekle.",
  addExpert: "Yeni uzman ekle",
  conversationTitle: "Tek bir kişiye mi, bütün ekibe mi?",
  conversationDescription:
    "Uzmanın profilinden birebir konuş. Ortak bir konu için şirket odasını kullan.",
  companyRoom: "Şirket odasına git",
  directory: "Uzman dizini",
  search: "Uzman ara",
  searchPlaceholder: "Ad, uzmanlık veya yapmak istediğin iş…",
  department: "Uzmanlık alanı",
  allDepartments: "Tüm uzmanlıklar",
  general: "Genel",
  departments: DEPARTMENT_LABELS,
  summaries: {
    ceo: "Hedefi plana çevirir, iş paylaşımını koordine eder ve sonuçları birleştirir.",
    marketing_director:
      "Hedef kitle, marka mesajı ve ölçülebilir büyüme planları üzerinde çalışır.",
    sales_director:
      "Müşteri ihtiyaçlarını, satış fırsatlarını ve teklif hazırlığını yönetir.",
    operations_director:
      "İş süreçlerini, sorumlulukları ve operasyonun düzenli ilerlemesini takip eder.",
    finance_director:
      "Bütçe, maliyet ve finansal planları veriye dayalı olarak değerlendirir.",
    product_director:
      "Kullanıcı ihtiyacını ürün kapsamına, önceliklere ve kabul kriterlerine çevirir.",
    engineering_director:
      "Çalışan yazılım, teknik uygulama ve sürdürülebilir mimariyi yönetir.",
    research_director:
      "Kaynakları araştırır, iddiaları doğrular ve karar için bulguları toplar.",
    support_director:
      "Müşteri sorunlarını sınıflandırır, çözüm ve anlaşılır yanıt taslakları hazırlar.",
    content_director:
      "Markanın diline uygun yazılar, içerik planları ve yayın taslakları üretir.",
    ux_designer:
      "Karmaşık ekranları kolay kullanılan, erişilebilir ve mobil uyumlu akışlara dönüştürür.",
    quality_engineer:
      "Çalışmayı gerçek senaryolarla test eder; hataları ve teslim kanıtlarını raporlar.",
    data_analyst:
      "Veriyi inceler, hesapları doğrular ve karar vermeyi kolaylaştıran analizler hazırlar.",
    automation_specialist:
      "Tekrarlanan işleri kontrollü, izlenebilir ve hata durumundan toparlanabilen akışlara çevirir.",
  },
  customSummary: (role) =>
    `\u2068${role}\u2069. Çalışma talimatlarını ve yetkilerini profilinden inceleyebilirsin.`,
  filterStatus: "Uzman durumu",
  all: "Tümü",
  statuses: {
    idle: "Hazır",
    working: "Çalışıyor",
    blocked: "Destek bekliyor",
    archived: "Arşivlendi",
  },
  count: (shown, total, filtered) =>
    `${shown} uzman${filtered ? ` / ${total}` : ""}`,
  loading: "Uzmanlar yükleniyor…",
  countUnavailable: "Kadro sayısı alınamadı",
  loadFailed: "Uzmanlar yüklenemedi",
  refreshFailed: "Uzmanlar güncellenemedi",
  errorDescription: "Bağlantını kontrol edip yeniden dene.",
  staleDescription:
    "Son alınan kadro gösteriliyor. Bağlantını kontrol edip yeniden dene.",
  retry: "Yeniden dene",
  noMatch: "Eşleşen uzman bulunamadı",
  noMatchDescription: "Aramayı kısaltabilir veya filtreleri temizleyebilirsin.",
  emptyTitle: "İlk uzmanını ekle",
  emptyDescription: "Hazır bir rol seçerek ekibini oluşturmaya başla.",
  clearFilters: "Filtreleri temizle",
  pagination: "Uzman sayfaları",
  previous: "Önceki",
  next: "Sonraki",
  page: (current, total) => `Sayfa ${current} / ${total}`,
  workingAction: "Atanan görev üzerinde çalışıyor",
  openProfile: "Profil ve çalışma talimatları",
} satisfies AgentDirectoryCopy;

export default copy;
