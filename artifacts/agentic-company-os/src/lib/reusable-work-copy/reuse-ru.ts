import type { ReusableWorkCopy } from "../reusable-work-copy";

export default {
  incomingTitle: "Выберите описание для работы",
  incomingHelp:
    "Текущий черновик сохранится, пока вы не решите заменить его новым описанием.",
  keepCurrent: "Оставить текущий черновик",
  useIncoming: "Использовать новое описание",
  choiceError:
    "Вкладка не смогла сохранить ваш выбор. Текст по-прежнему можно редактировать. Повторите выбор перед запуском.",
  preparationOnly:
    "Этот выбор только подготавливает черновик. Он не запускает работу и не предоставляет доступ к инструментам.",
} satisfies ReusableWorkCopy;
