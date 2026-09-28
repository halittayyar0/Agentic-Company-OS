import type { AuthCopy } from "../auth-copy";

const copy = {
  badge: "دخول آمن للمشغّل",
  title: "الدخول إلى AgenticOS",
  description: "هذه النسخة محمية بمفتاح وصول يُستخدم فقط لإنشاء جلسة آمنة.",
  accessKey: "مفتاح الوصول",
  invalidSession: "تعذّر التحقق من الجلسة. حاول مجددًا.",
  loginFailed: "تعذّر تسجيل الدخول.",
  verifying: "جارٍ التحقق…",
  signIn: "تسجيل دخول آمن",
  checkingSession: "جارٍ التحقق من الجلسة الآمنة…",
  serviceUnavailable: "خدمة الجلسات غير متاحة",
  serviceUnavailableDescription:
    "تظل مساحة العمل مغلقة حتى يمكن التحقق من حالتها الأمنية.",
  retry: "أعد المحاولة",
  invalidKey: "مفتاح الوصول غير صالح.",
} satisfies AuthCopy;

export default copy;
