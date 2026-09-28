import type { ProjectListCopy } from "../project-list-copy";

const copy = {
  eyebrow: "مساحات عملك",
  title: "المشاريع",
  description:
    "تبقى المحادثات والاجتماعات وقرارات الفريق والمخرجات معًا ضمن سياق المشروع المعني.",
  schedulerPaused: "جدولة المهام متوقفة",
  newProject: "مشروع جديد",
  listLabel: "قائمة المشاريع",
  filterLabel: "تصفية المشاريع حسب الحالة",
  collections: { all: "الكل", active: "النشطة", completed: "المكتملة" },
  search: "ابحث في المشاريع",
  loading: "جارٍ تحميل المشاريع",
  errorTitle: "تعذّر تحميل المشاريع",
  errorDescription: "لن نعرض بيانات مشاريع قديمة.",
  retry: "أعد المحاولة",
  emptyInitialTitle: "الفريق مستعد للمشروع الأول",
  emptyFilteredTitle: "لا توجد مشاريع هنا",
  emptyInitialDescription:
    "اكتب هدفك ليعمل الخبراء النشطون معًا ضمن مشروع واحد.",
  emptyFilteredDescription: "غيّر عامل التصفية أو عبارة البحث.",
  createFirst: "أنشئ المشروع الأول",
  owner: (name) => `مسؤول المشروع: ${name}`,
  ownerId: (id) => `مسؤول المشروع #${id}`,
} satisfies ProjectListCopy;

export default copy;
