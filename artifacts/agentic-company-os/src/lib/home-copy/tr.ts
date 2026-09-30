import type { HomeCopy } from "../home-copy";

const copy = {
  deskKicker: "Senin çalışma masan",
  heroTitle: "Bugün neyi birlikte başarmalıyız?",
  heroDescription:
    "Hedefini anlat. Ekibin işi planlasın, uygun uzmanlar üretsin. Sen ilerlemeyi ve ortaya çıkan sonucu tek yerden takip et.",
  quickToolsTitle: "Model olmadan faydalı bir kontrol dene",
  quickToolsDescription:
    "CSV veya JSON dosyasını incele ya da iki listeyi bu tarayıcıda karşılaştır.",
  guideLabel: "Başlangıç rehberi",
  guideTitle: "Nasıl çalışır?",
  guideSteps: [
    {
      title: "Hedefi tarif et",
      text: "Ne istediğini ve iyi bir sonucun nasıl görüneceğini yaz.",
    },
    {
      title: "Ekip işi paylaşsın",
      text: "Plan, görevler ve sorumlular proje alanında bir araya gelir.",
    },
    {
      title: "Sonucu değerlendir",
      text: "Teslimleri ve kontrol sonuçlarını incele; gerektiğinde yön ver.",
    },
  ],
  controlTitle: "Kontrol sende",
  controlDescription:
    "Onay gereken işlemler bekler. Çalışmayı üst menüden durdurabilirsin.",
  firstUse: "İlk kullanım: bağlantıları kontrol et",
  meetExperts: "{count} uzmanı tanı",
  seeRoles: "Kimin hangi işte yardımcı olduğunu gör.",
  resumeKicker: "Kaldığın yerden devam et",
  recentProjects: "Son projeler",
  viewAll: "Tümünü gör",
  projectsLoadError: "Projeler alınamadı",
  retry: "Yeniden dene",
  sharedSpacesLabel: "Ortak çalışma alanları",
  companyRoomTitle: "Şirket odası",
  companyRoomDescription:
    "Ekibe bir soru sor veya fikrini paylaş. İlgili uzmanlar konuşmaya katılsın.",
  trackProjectsTitle: "Projelerini takip et",
  trackProjectsDescription:
    "Planı, görevleri ve ortaya çıkan teslimleri proje alanında incele.",
  buildTeamTitle: "Hazır bir ekip kur",
  buildTeamDescription:
    "İşine uygun uzmanları ve çalışma sırasını hazır ekiplerden seç.",
  teamLoading: "Ekip yükleniyor",
  activeTeamMembers: "{count} aktif ekip üyesi",
  projectOwner: "Proje sorumlusu",
  emptyProjectsTitle: "İlk projen için her şey burada",
  emptyProjectsDescription:
    "Yukarıdaki örneklerden birini seçebilir veya kendi hedefini yazabilirsin.",
  detailedProject: "Ayrıntılı proje kur",
  open: "Aç",
  rosterLoadError: "Ekip kadrosu yüklenemedi",
  rosterLoadDescription: "Bağlantını kontrol edip yeniden dene.",
  modeGroup: "Çalışma yaklaşımı",
  modes: {
    team: {
      label: "Ekip",
      hint: "Ekip, hedefe göre iş paylaşımı yapar.",
      instruction:
        "Hedefi ve kabul kriterlerini netleştir. Mevcut ekipten uygun uzmanlara çakışmayan sorumluluklar ver; bağımlılıkları sıraya koy. Üretimden sonra uygun bir uzman teslimi bağımsız doğrulasın. Sonucu, kanıtı ve kalan eksikleri tek teslimde birleştir.",
    },
    engineer: {
      label: "Ürün geliştir",
      hint: "Tasarım, geliştirme ve test aynı hedefte buluşur.",
      instruction:
        "Çalışan ürün üret. Tasarım, uygulama ve bağımsız kalite kontrol adımlarını uygun mevcut uzmanlara dağıt. Gerçek test kanıtı, çalıştırma bilgisi ve açık eksiklerle teslim et.",
    },
    research: {
      label: "Araştır",
      hint: "Kaynakları inceleyip gerekçeli bir sonuç hazırlayın.",
      instruction:
        "Kaynak, kanıt ve karar odağıyla çalış. Doğrulanmış bulgu, varsayım ve çıkarımı ayır. Sonucu izlenebilir kaynaklar ve belirsizlikleriyle teslim et.",
    },
    compare: {
      label: "Karşılaştır",
      hint: "Seçenekleri ortak ölçütlerle değerlendirin.",
      instruction:
        "En az iki yaklaşımı aynı açık ölçütlerle değerlendir. Veri boşluklarını belirt; gerekçeli öneri ve karar tablosuyla teslim et.",
    },
  },
  validationShort: "Hedefini biraz daha anlat: en az 10 karakter yaz.",
  validationLong: "Hedefini 7.000 karakter içinde özetle.",
  examples: [
    {
      label: "Bir web sitesi hazırla",
      mode: "engineer",
      prompt:
        "İşletmem için mobilde kolay kullanılan bir web sitesi hazırla. Önce sayfa yapısını planla, ardından tasarım ve çalışan uygulamayı oluştur. Formları, mobil görünümü ve erişilebilirliği kontrol et; sonucu test kanıtlarıyla teslim et.",
    },
    {
      label: "Bir konuyu araştır",
      mode: "research",
      prompt:
        "Yeni ürün fikrim için hedef kitleyi ve mevcut alternatifleri araştır. Kaynaklarıyla bir karşılaştırma, kullanıcı ihtiyaçları ve ilk denenecek üç adımı hazırla. Fikrim ve hedef kitlem: ",
    },
    {
      label: "Bir süreci iyileştir",
      mode: "team",
      prompt:
        "Tekrarlanan bir iş sürecini sadeleştirip otomasyon planı hazırla. Girdi, sorumlu, çıktı, hata durumları ve kontrol noktalarını tanımla. İyileştirmek istediğim süreç: ",
    },
  ],
  projectReadyTitle: "Proje alanı hazır",
  projectReadyDescription:
    "Planı, ekibin çalışmalarını ve teslimleri buradan takip edebilirsin.",
  projectLaunchError:
    "Proje başlatılamadı. Bağlantını ve model ayarlarını kontrol edip yeniden dene. Taslağın korunuyor.",
  desiredOutcome: "Üretmek istediğin sonuç",
  placeholder:
    "Örneğin: Küçük işletmem için randevu alınabilen bir web sitesi hazırla…",
  composerHelp: "Hedefi, kısıtları ve beklediğin teslimi yaz.",
  submitShortcut: "Ctrl / ⌘ + Enter ile başlat",
  startingProject: "Proje açılıyor…",
  startProject: "Projeyi başlat",
  blocked:
    "Güvenlik freni açık. Proje başlatmak için durdurma durumunu kontrol et; yazdıkların bu ekranda korunur.",
  beforeStart: "Başlamadan önce",
  firstExpert: "ilk uzmanını ekle",
  exampleKicker: "Bir örnekle başlayabilirsin",
} satisfies HomeCopy;

export default copy;
