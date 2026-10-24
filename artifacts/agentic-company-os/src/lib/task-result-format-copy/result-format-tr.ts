import type { ResultFormatCopy } from "../task-result-format-copy";
export default {
  title: "Sonuç biçimi",
  plain: "Serbest metin",
  table: "Tablo",
  columns: "Sütun başlıkları",
  help: "İsteğe bağlı. Her döngü tamamlanmadan önce sonuçta bu sütunlar sırayla bulunmalıdır. Bu kontrol yapıyı denetler; bilgilerin doğruluğunu onaylamaz ve izin vermez.",
  add: "Sütun ekle",
  remove: "Sütunu kaldır",
  invalid:
    "Başında veya sonunda boşluk ya da kontrol karakteri bulunmayan, her biri 1–80 karakterlik 2–8 farklı başlık kullanın.",
  saved: "Kaydedilen sonuç biçimi",
  defaults: ["Sorumlu", "İş", "Tarih"],
} satisfies ResultFormatCopy;
