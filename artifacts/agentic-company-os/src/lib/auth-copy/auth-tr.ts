import type { AuthCopy } from "../auth-copy";

const copy = {
  badge: "Güvenli operatör girişi",
  title: "AgenticOS'a eriş",
  description:
    "Bu kurulum erişim anahtarıyla korunuyor. Anahtar yalnızca güvenli oturum oluşturmak için kullanılır.",
  accessKey: "Erişim anahtarı",
  invalidSession: "Oturum doğrulanamadı. Tekrar dene.",
  loginFailed: "Giriş tamamlanamadı.",
  verifying: "Doğrulanıyor…",
  signIn: "Güvenli oturum aç",
  checkingSession: "Güvenli oturum doğrulanıyor…",
  serviceUnavailable: "Oturum servisine ulaşılamıyor",
  serviceUnavailableDescription:
    "Güvenlik durumu doğrulanamadığı için çalışma alanı kapalı tutuluyor.",
  retry: "Yeniden dene",
  invalidKey: "Erişim anahtarı geçersiz.",
} satisfies AuthCopy;

export default copy;
