import type { AuthCopy } from "../auth-copy";

const copy = {
  badge: "Безопасный вход оператора",
  title: "Войти в AgenticOS",
  description:
    "Эта установка защищена ключом доступа. Ключ используется только для создания защищённого сеанса.",
  accessKey: "Ключ доступа",
  invalidSession: "Не удалось подтвердить сеанс. Повторите попытку.",
  loginFailed: "Не удалось войти.",
  verifying: "Проверка…",
  signIn: "Безопасный вход",
  checkingSession: "Проверяем защищённый сеанс…",
  serviceUnavailable: "Служба сеансов недоступна",
  serviceUnavailableDescription:
    "Рабочее пространство закрыто, пока нельзя проверить состояние безопасности.",
  retry: "Повторить",
  invalidKey: "Неверный ключ доступа.",
} satisfies AuthCopy;

export default copy;
