import type { WorkspaceLocale } from "./workspace-locale";
const copy = {
  tr: {
    title: "Sonucu incele",
    pending:
      "Model sonucu reddetti. Önerilen sonuç kullanıcı incelemesi bekliyor.",
    confirmed: "Sonuç kullanıcı tarafından onaylandı.",
    rejected: "Kullanıcı önerilen sonucu reddetti.",
  },
  en: {
    title: "Review result",
    pending:
      "The model rejected this result. The proposed result awaits operator review.",
    confirmed: "The operator confirmed the result.",
    rejected: "The operator rejected the proposed result.",
  },
  de: {
    title: "Ergebnis prüfen",
    pending:
      "Das Modell hat das Ergebnis abgelehnt. Der Vorschlag wartet auf Ihre Prüfung.",
    confirmed: "Das Ergebnis wurde vom Benutzer bestätigt.",
    rejected: "Der Benutzer hat das vorgeschlagene Ergebnis abgelehnt.",
  },
  ru: {
    title: "Проверить результат",
    pending:
      "Модель отклонила результат. Предложение ожидает проверки пользователя.",
    confirmed: "Пользователь подтвердил результат.",
    rejected: "Пользователь отклонил предложенный результат.",
  },
  "zh-CN": {
    title: "检查结果",
    pending: "模型拒绝了此结果。建议结果等待用户检查。",
    confirmed: "用户已确认结果。",
    rejected: "用户拒绝了建议结果。",
  },
  "zh-TW": {
    title: "檢查結果",
    pending: "模型拒絕了此結果。建議結果等待使用者檢查。",
    confirmed: "使用者已確認結果。",
    rejected: "使用者拒絕了建議結果。",
  },
  ar: {
    title: "مراجعة النتيجة",
    pending:
      "رفض النموذج هذه النتيجة. النتيجة المقترحة بانتظار مراجعة المستخدم.",
    confirmed: "أكد المستخدم النتيجة.",
    rejected: "رفض المستخدم النتيجة المقترحة.",
  },
} as const;
export function taskResultReviewCopy(locale: WorkspaceLocale) {
  return copy[locale];
}
