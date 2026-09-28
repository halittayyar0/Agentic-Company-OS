export const DEPARTMENT_LABELS = {
  executive: "Yönetim",
  marketing: "Pazarlama",
  sales: "Satış",
  operations: "Operasyon",
  finance: "Finans",
  product: "Ürün",
  engineering: "Mühendislik",
  research: "Araştırma",
  support: "Müşteri desteği",
  content: "İçerik",
  design: "Tasarım",
  quality: "Kalite",
  data: "Veri",
  automation: "Otomasyon",
  custom: "Özel uzmanlık",
} as const;
export function departmentLabel(value: string | null | undefined): string {
  if (!value) return "Genel";
  const label = DEPARTMENT_LABELS[value as keyof typeof DEPARTMENT_LABELS];
  return typeof label === "string" ? label : value;
}
export function normalizeDirectoryQuery(value: string, locale = "tr"): string {
  return value
    .toLocaleLowerCase(locale)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\u0640/gu, "")
    .replace(/ı/gu, "i");
}
