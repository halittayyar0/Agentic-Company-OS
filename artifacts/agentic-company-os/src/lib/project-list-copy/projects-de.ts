import type { ProjectListCopy } from "../project-list-copy";

const copy = {
  eyebrow: "Deine Arbeitsbereiche",
  title: "Projekte",
  description:
    "Gespräche, Besprechungen, Teamentscheidungen und Ergebnisse bleiben im jeweiligen Projekt zusammen.",
  schedulerPaused: "Aufgabenplanung ist angehalten",
  newProject: "Neues Projekt",
  listLabel: "Projektliste",
  filterLabel: "Projekte nach Status filtern",
  collections: { all: "Alle", active: "Aktiv", completed: "Abgeschlossen" },
  search: "Projekte durchsuchen",
  loading: "Projekte werden geladen",
  errorTitle: "Projekte konnten nicht geladen werden",
  errorDescription: "Veraltete Projektdaten werden nicht angezeigt.",
  retry: "Erneut versuchen",
  emptyInitialTitle: "Das Team ist bereit für das erste Projekt",
  emptyFilteredTitle: "Hier sind keine Projekte",
  emptyInitialDescription:
    "Beschreibe dein Ziel, damit aktive Fachkräfte gemeinsam an einem Projekt arbeiten können.",
  emptyFilteredDescription: "Ändere den Filter oder den Suchbegriff.",
  createFirst: "Erstes Projekt erstellen",
  owner: (name) => `Projektverantwortliche Person: ${name}`,
  ownerId: (id) => `Projektverantwortliche Person #${id}`,
} satisfies ProjectListCopy;

export default copy;
