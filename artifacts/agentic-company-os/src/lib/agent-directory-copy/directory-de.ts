import type { AgentDirectoryCopy } from "../agent-directory-copy";

const copy = {
  eyebrow: "Lerne dein Team kennen",
  title: "Die passende Fachkraft für deine Arbeit.",
  description:
    "Entdecke die Aufgaben deiner Fachkräfte, beginne ein Gespräch oder ergänze dein Team um eine neue Rolle.",
  addExpert: "Fachkraft hinzufügen",
  conversationTitle: "Eine Person oder das ganze Team?",
  conversationDescription:
    "Führe ein Einzelgespräch über das Profil. Für gemeinsame Themen nutze den Unternehmensraum.",
  companyRoom: "Unternehmensraum öffnen",
  directory: "Fachkräfteverzeichnis",
  search: "Fachkräfte suchen",
  searchPlaceholder: "Name, Fachgebiet oder geplante Arbeit…",
  department: "Fachgebiet",
  allDepartments: "Alle Fachgebiete",
  general: "Allgemein",
  departments: {
    executive: "Leitung",
    marketing: "Marketing",
    sales: "Vertrieb",
    operations: "Betrieb",
    finance: "Finanzen",
    product: "Produkt",
    engineering: "Entwicklung",
    research: "Forschung",
    support: "Kundendienst",
    content: "Inhalte",
    design: "Design",
    quality: "Qualität",
    data: "Daten",
    automation: "Automatisierung",
    custom: "Individuelles Fachgebiet",
  },
  summaries: {
    ceo: "Übersetzt Ziele in Pläne, koordiniert Zuständigkeiten und führt Ergebnisse zusammen.",
    marketing_director:
      "Arbeitet an Zielgruppen, Markenbotschaften und messbaren Wachstumsplänen.",
    sales_director:
      "Strukturiert Kundenbedürfnisse, Verkaufschancen und die Angebotserstellung.",
    operations_director:
      "Verfolgt Abläufe, Zuständigkeiten und den Fortschritt im Tagesgeschäft.",
    finance_director:
      "Bewertet Budgets, Kosten und Finanzpläne anhand verfügbarer Daten.",
    product_director:
      "Überträgt Nutzerbedürfnisse in Produktumfang, Prioritäten und Abnahmekriterien.",
    engineering_director:
      "Koordiniert funktionsfähige Software, technische Umsetzung und wartbare Architektur.",
    research_director:
      "Recherchiert Quellen, prüft Aussagen und sammelt Erkenntnisse für Entscheidungen.",
    support_director:
      "Ordnet Kundenprobleme und entwirft Lösungen sowie verständliche Antworten.",
    content_director:
      "Erstellt Texte, Inhaltspläne und Veröffentlichungsentwürfe in der Sprache der Marke.",
    ux_designer:
      "Gestaltet aus komplexen Oberflächen zugängliche Abläufe für Smartphone und Computer.",
    quality_engineer:
      "Prüft Arbeit anhand realistischer Szenarien und dokumentiert Fehler und Liefernachweise.",
    data_analyst:
      "Untersucht Daten, prüft Berechnungen und erstellt Analysen als Entscheidungsgrundlage.",
    automation_specialist:
      "Überführt wiederkehrende Arbeit in kontrollierte, nachvollziehbare Abläufe mit Fehlerbehandlung.",
  },
  customSummary: (role) =>
    `\u2068${role}\u2069. Arbeitsanweisungen und Berechtigungen findest du im Profil.`,
  filterStatus: "Fachkräfte nach Status filtern",
  all: "Alle",
  statuses: {
    idle: "Bereit",
    working: "Arbeitet",
    blocked: "Benötigt Unterstützung",
    archived: "Archiviert",
  },
  count: (shown, total, filtered) =>
    filtered ? `Fachkräfte: ${shown} von ${total}` : `Fachkräfte: ${shown}`,
  loading: "Fachkräfte werden geladen…",
  countUnavailable: "Teamgröße nicht verfügbar",
  loadFailed: "Fachkräfte konnten nicht geladen werden",
  refreshFailed: "Fachkräfte konnten nicht aktualisiert werden",
  errorDescription: "Prüfe deine Verbindung und versuche es erneut.",
  staleDescription:
    "Das zuletzt geladene Team wird angezeigt. Prüfe deine Verbindung und versuche es erneut.",
  retry: "Erneut versuchen",
  noMatch: "Keine passenden Fachkräfte",
  noMatchDescription: "Verkürze die Suche oder setze die Filter zurück.",
  emptyTitle: "Füge deine erste Fachkraft hinzu",
  emptyDescription: "Wähle eine vordefinierte Rolle, um dein Team aufzubauen.",
  clearFilters: "Filter zurücksetzen",
  pagination: "Verzeichnisseiten",
  previous: "Zurück",
  next: "Weiter",
  page: (current, total) => `Seite ${current} von ${total}`,
  workingAction: "Arbeitet an der zugewiesenen Aufgabe",
  openProfile: "Profil und Arbeitsanweisungen",
} satisfies AgentDirectoryCopy;

export default copy;
