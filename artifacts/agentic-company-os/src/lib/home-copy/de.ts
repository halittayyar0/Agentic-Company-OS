import type { HomeCopy } from "../home-copy";

const copy = {
  draftStorageError:
    "Dieser Tab kann den Entwurf beim Neuladen nicht wiederherstellen. Sie können den Text hier weiter bearbeiten; kopieren Sie ihn vor dem Neuladen oder Schließen des Tabs.",
  deskKicker: "Dein Arbeitsbereich",
  heroTitle: "Was wollen wir heute gemeinsam erreichen?",
  heroDescription:
    "Beschreibe das gewünschte Ergebnis. Ein vorhandener Agent beginnt die Arbeit und zieht bei Bedarf passende Fachkräfte hinzu. Verfolge Fortschritt und Ergebnis an einem Ort.",
  quickToolsTitle: "Nützliche Prüfung ohne Modell ausprobieren",
  quickToolsDescription:
    "Prüfe CSV oder JSON oder vergleiche zwei Listen direkt im Browser.",
  guideLabel: "Erste Schritte",
  guideTitle: "So funktioniert es",
  guideSteps: [
    {
      title: "Ziel beschreiben",
      text: "Schreibe, was du brauchst und wie ein gutes Ergebnis aussieht.",
    },
    {
      title: "Den Agenten starten lassen",
      text: "Kleine Aufgaben erledigt derselbe Agent. Für unabhängige Arbeiten kommt eine passende vorhandene Fachkraft hinzu.",
    },
    {
      title: "Ergebnis prüfen",
      text: "Prüfe Lieferungen und Kontrollen und greife bei Bedarf ein.",
    },
  ],
  controlTitle: "Du behältst die Kontrolle",
  controlDescription:
    "Genehmigungspflichtige Aktionen warten auf dich. Über die obere Leiste kannst du die Arbeit stoppen.",
  firstUse: "Zuerst: Verbindungen prüfen",
  meetExperts: "{count} Fachkräfte kennenlernen",
  seeRoles: "Sieh, wobei jede Fachkraft helfen kann.",
  resumeKicker: "Dort weitermachen, wo du aufgehört hast",
  recentProjects: "Letzte Projekte",
  viewAll: "Alle ansehen",
  projectsLoadError: "Projekte konnten nicht geladen werden",
  retry: "Erneut versuchen",
  sharedSpacesLabel: "Gemeinsame Arbeitsbereiche",
  companyRoomTitle: "Teamraum",
  companyRoomDescription:
    "Stelle dem Team eine Frage oder teile eine Idee. Passende Fachkräfte beteiligen sich.",
  trackProjectsTitle: "Projekte verfolgen",
  trackProjectsDescription:
    "Prüfe Plan, Aufgaben und Ergebnisse im jeweiligen Projektbereich.",
  buildTeamTitle: "Ein fertiges Team einrichten",
  buildTeamDescription:
    "Wähle Fachkräfte und Arbeitsablauf aus einem vorbereiteten Team.",
  teamLoading: "Team wird geladen",
  activeTeamMembers: "{count} aktive Teammitglieder",
  projectOwner: "Projektverantwortliche Person",
  emptyProjectsTitle: "Hier beginnt dein erstes Projekt",
  emptyProjectsDescription:
    "Wähle oben ein Beispiel oder beschreibe dein eigenes Ziel.",
  detailedProject: "Detailliertes Projekt erstellen",
  open: "Öffnen",
  rosterLoadError: "Team konnte nicht geladen werden",
  rosterLoadDescription: "Prüfe deine Verbindung und versuche es erneut.",
  modeGroup: "Arbeitsansatz",
  modes: {
    team: {
      label: "Aufgabe erledigen",
      hint: "Mit einem vorhandenen Agenten beginnen; bei Bedarf passende Fachkräfte hinzuziehen.",
      instruction:
        "Beginne mit einem passenden vorhandenen Agenten. Erledige kleine Aufgaben selbst. Delegiere nur unabhängige Ergebnisse oder notwendige Facharbeit an einen passenden vorhandenen Agenten; begrenze parallele Arbeit. Kläre Ziel und Abnahmekriterien und prüfe das Ergebnis angemessen. Fasse Ergebnis, Belege und offene Punkte in einer Übergabe zusammen.",
    },
    engineer: {
      label: "Produkt entwickeln",
      hint: "Design, Entwicklung und Tests arbeiten auf dasselbe Ziel hin.",
      instruction:
        "Erstelle ein funktionsfähiges Produkt. Erledige kleine Aufgaben selbst; ziehe nur für unabhängige Ergebnisse oder notwendige Facharbeit eine passende vorhandene Fachkraft hinzu. Schließe Design, Umsetzung und angemessene Qualitätsprüfungen ab. Liefere echte Testbelege, Startanweisungen und bekannte Lücken.",
    },
    research: {
      label: "Recherchieren",
      hint: "Quellen prüfen und eine begründete Schlussfolgerung erarbeiten.",
      instruction:
        "Arbeite quellen-, beleg- und entscheidungsorientiert. Trenne bestätigte Erkenntnisse, Annahmen und Schlussfolgerungen. Liefere nachvollziehbare Quellen und Unsicherheiten mit dem Ergebnis.",
    },
    compare: {
      label: "Vergleichen",
      hint: "Optionen anhand derselben Kriterien bewerten.",
      instruction:
        "Bewerte mindestens zwei Ansätze anhand derselben klaren Kriterien. Benenne Datenlücken und liefere eine begründete Empfehlung mit Entscheidungstabelle.",
    },
  },
  validationShort: "Beschreibe dein Ziel genauer: mindestens 10 Zeichen.",
  validationLong: "Fasse dein Ziel in höchstens 7.000 Zeichen zusammen.",
  examples: [
    {
      label: "Eine Website erstellen",
      mode: "engineer",
      prompt:
        "Erstelle eine mobilfreundliche Website für mein Unternehmen. Plane zuerst die Seitenstruktur und setze dann Design und funktionierende Website um. Prüfe Formulare, mobile Ansicht und Barrierefreiheit; liefere das Ergebnis mit Testbelegen.",
    },
    {
      label: "Ein Thema recherchieren",
      mode: "research",
      prompt:
        "Untersuche Zielgruppe und bestehende Alternativen für meine neue Produktidee. Erstelle einen Vergleich mit Quellen, Nutzerbedürfnissen und den ersten drei Schritten. Meine Idee und Zielgruppe: ",
    },
    {
      label: "Einen Prozess verbessern",
      mode: "team",
      prompt:
        "Vereinfache einen wiederkehrenden Arbeitsprozess und erstelle einen Automatisierungsplan. Definiere Eingaben, Verantwortliche, Ergebnisse, Fehlerfälle und Kontrollpunkte. Diesen Prozess möchte ich verbessern: ",
    },
  ],
  projectReadyTitle: "Projektbereich ist bereit",
  projectReadyDescription:
    "Hier kannst du Plan, Teamarbeit und Ergebnisse verfolgen.",
  projectLaunchError:
    "Das Projekt konnte nicht gestartet werden. Prüfe Verbindung und Modelleinstellungen und versuche es erneut. Dein Entwurf bleibt erhalten.",
  desiredOutcome: "Gewünschtes Ergebnis",
  placeholder:
    "Zum Beispiel: Erstelle eine Website, auf der Kunden Termine für mein kleines Unternehmen buchen können…",
  composerHelp: "Beschreibe Ziel, Einschränkungen und erwartete Lieferung.",
  submitShortcut: "Mit Strg / ⌘ + Enter starten",
  startingProject: "Projekt wird gestartet…",
  startProject: "Projekt starten",
  blocked:
    "Der Sicherheitsstopp ist aktiv. Prüfe den Stoppstatus, bevor du ein Projekt startest; dein Text bleibt hier erhalten.",
  beforeStart: "Bevor du beginnst,",
  firstExpert: "füge deine erste Fachkraft hinzu",
  exampleKicker: "Mit einem Beispiel beginnen",
} satisfies HomeCopy;

export default copy;
