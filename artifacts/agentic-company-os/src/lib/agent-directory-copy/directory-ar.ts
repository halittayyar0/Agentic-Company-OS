import type { AgentDirectoryCopy } from "../agent-directory-copy";

const copy = {
  eyebrow: "تعرّف إلى فريقك",
  title: "الخبير المناسب لعملك.",
  description:
    "اكتشف مهام كل خبير، وابدأ محادثة، أو أضف دورًا جديدًا إلى فريقك.",
  addExpert: "إضافة خبير",
  conversationTitle: "خبير واحد أم الفريق بأكمله؟",
  conversationDescription:
    "ابدأ محادثة فردية من ملف الخبير. استخدم غرفة الفريق لمناقشة موضوع مشترك.",
  companyRoom: "افتح غرفة الفريق",
  directory: "دليل الخبراء",
  search: "ابحث عن خبير",
  searchPlaceholder: "الاسم أو التخصص أو العمل الذي تود إنجازه…",
  department: "مجال التخصص",
  allDepartments: "جميع التخصصات",
  general: "عام",
  departments: {
    executive: "الإدارة",
    marketing: "التسويق",
    sales: "المبيعات",
    operations: "العمليات",
    finance: "المالية",
    product: "المنتج",
    engineering: "الهندسة",
    research: "البحث",
    support: "دعم العملاء",
    content: "المحتوى",
    design: "التصميم",
    quality: "الجودة",
    data: "البيانات",
    automation: "الأتمتة",
    custom: "تخصص مخصص",
  },
  summaries: {
    ceo: "يحوّل الأهداف إلى خطط وينسّق المسؤوليات ويجمع النتائج.",
    marketing_director:
      "يعمل على الجمهور المستهدف ورسالة العلامة التجارية وخطط النمو القابلة للقياس.",
    sales_director: "ينظّم احتياجات العملاء وفرص المبيعات وإعداد العروض.",
    operations_director: "يتابع سير العمل والمسؤوليات وتقدّم العمليات اليومية.",
    finance_director:
      "يقيّم الميزانيات والتكاليف والخطط المالية بناءً على البيانات المتاحة.",
    product_director:
      "يحوّل احتياجات المستخدمين إلى نطاق للمنتج وأولويات ومعايير قبول.",
    engineering_director:
      "ينسّق تطوير البرمجيات القابلة للاستخدام والتنفيذ التقني والبنية القابلة للصيانة.",
    research_director:
      "يبحث في المصادر ويتحقق من الادعاءات ويجمع النتائج لدعم القرارات.",
    support_director:
      "يصنّف مشكلات العملاء ويعدّ مسودات للحلول والردود الواضحة.",
    content_director:
      "ينتج نصوصًا وخطط محتوى ومسودات للنشر تتوافق مع صوت العلامة التجارية.",
    ux_designer:
      "يحوّل الشاشات المعقدة إلى تدفقات سهلة الإتاحة تعمل على الهواتف والحواسيب.",
    quality_engineer:
      "يختبر العمل بسيناريوهات واقعية ويوثّق الأخطاء وأدلة التسليم.",
    data_analyst:
      "يفحص البيانات ويتحقق من الحسابات ويعدّ تحليلات تدعم اتخاذ القرارات.",
    automation_specialist:
      "يحوّل الأعمال المتكررة إلى تدفقات مضبوطة وقابلة للمراقبة والتعافي من الأخطاء.",
  },
  customSummary: (role) =>
    `\u2068${role}\u2069. راجع تعليمات العمل والصلاحيات في ملف الخبير.`,
  filterStatus: "تصفية الخبراء حسب الحالة",
  all: "الكل",
  statuses: {
    idle: "جاهز",
    working: "يعمل",
    blocked: "يحتاج إلى دعم",
    archived: "مؤرشف",
  },
  count: (shown, total, filtered) =>
    filtered ? `الخبراء: ${shown} من ${total}` : `الخبراء: ${shown}`,
  loading: "جارٍ تحميل الخبراء…",
  countUnavailable: "عدد أعضاء الفريق غير متاح",
  loadFailed: "تعذّر تحميل الخبراء",
  refreshFailed: "تعذّر تحديث الخبراء",
  errorDescription: "تحقق من اتصالك وحاول مجددًا.",
  staleDescription: "يُعرض آخر فريق تم تحميله. تحقق من اتصالك وحاول مجددًا.",
  retry: "حاول مجددًا",
  noMatch: "لا يوجد خبراء مطابقون",
  noMatchDescription: "جرّب عبارة بحث أقصر أو امسح عوامل التصفية.",
  emptyTitle: "أضف خبيرك الأول",
  emptyDescription: "اختر دورًا جاهزًا لبدء بناء فريقك.",
  clearFilters: "مسح عوامل التصفية",
  pagination: "صفحات دليل الخبراء",
  previous: "السابق",
  next: "التالي",
  page: (current, total) => `الصفحة ${current} من ${total}`,
  workingAction: "يعمل على المهمة المسندة إليه",
  openProfile: "الملف وتعليمات العمل",
} satisfies AgentDirectoryCopy;

export default copy;
