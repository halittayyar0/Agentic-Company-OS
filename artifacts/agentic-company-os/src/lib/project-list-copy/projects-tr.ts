import type { ProjectListCopy } from "../project-list-copy";

const copy = {
  eyebrow: "Çalışma alanların",
  title: "Projeler",
  description:
    "Konuşmalar, toplantılar, ekip kararları ve teslimler ait oldukları proje bağlamında birlikte kalır.",
  schedulerPaused: "Görev zamanlayıcı durduruldu",
  newProject: "Yeni proje",
  listLabel: "Proje listesi",
  filterLabel: "Projeleri duruma göre filtrele",
  collections: { all: "Hepsi", active: "Aktif", completed: "Tamamlanan" },
  search: "Projelerde ara",
  loading: "Projeler yükleniyor",
  errorTitle: "Projeler yüklenemedi",
  errorDescription: "Güncel olmayan proje verisi göstermiyoruz.",
  retry: "Yeniden dene",
  emptyInitialTitle: "İlk proje için ekip hazır",
  emptyFilteredTitle: "Burada proje yok",
  emptyInitialDescription:
    "Hedefi yaz; tüm aktif uzmanlar aynı proje bağlamında çalışmaya başlasın.",
  emptyFilteredDescription: "Filtreyi veya arama ifadesini değiştir.",
  createFirst: "İlk projeyi oluştur",
  owner: (name) => `Proje sorumlusu: ${name}`,
  ownerId: (id) => `Proje sorumlusu #${id}`,
} satisfies ProjectListCopy;

export default copy;
