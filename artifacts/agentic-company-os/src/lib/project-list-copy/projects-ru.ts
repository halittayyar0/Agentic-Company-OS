import type { ProjectListCopy } from "../project-list-copy";

const copy = {
  eyebrow: "Ваши рабочие пространства",
  title: "Проекты",
  description:
    "Обсуждения, встречи, решения команды и результаты остаются вместе в контексте своего проекта.",
  schedulerPaused: "Планировщик задач остановлен",
  newProject: "Новый проект",
  listLabel: "Список проектов",
  filterLabel: "Фильтр проектов по статусу",
  collections: { all: "Все", active: "Активные", completed: "Завершённые" },
  search: "Поиск проектов",
  loading: "Загрузка проектов",
  errorTitle: "Не удалось загрузить проекты",
  errorDescription: "Мы не показываем устаревшие данные проектов.",
  retry: "Повторить",
  emptyInitialTitle: "Команда готова к первому проекту",
  emptyFilteredTitle: "Здесь нет проектов",
  emptyInitialDescription:
    "Опишите цель, чтобы активные специалисты работали над ней вместе.",
  emptyFilteredDescription: "Измените фильтр или поисковый запрос.",
  createFirst: "Создать первый проект",
  owner: (name) => `Ответственный за проект: ${name}`,
  ownerId: (id) => `Ответственный за проект #${id}`,
} satisfies ProjectListCopy;

export default copy;
