import type { ReusableWorkCopy } from "../reusable-work-copy";

export default {
  incomingTitle: "Beschreibung für die weitere Arbeit wählen",
  incomingHelp:
    "Ihr bisheriger Entwurf bleibt erhalten, bis Sie ihn durch die neue Beschreibung ersetzen.",
  keepCurrent: "Bisherigen Entwurf behalten",
  useIncoming: "Neue Beschreibung verwenden",
  choiceError:
    "Dieser Tab konnte Ihre Auswahl nicht speichern. Der bearbeitbare Text ist noch vorhanden. Versuchen Sie die Auswahl vor dem Start erneut.",
  preparationOnly:
    "Diese Auswahl bereitet nur den Entwurf vor. Sie startet keine Arbeit und erteilt keinen Werkzeugzugriff.",
  savedBrief: "Gespeicherte Aufgabenbeschreibung",
  useBrief: "Beschreibung erneut verwenden",
  prepareGuide: "Persönlichen Leitfaden vorbereiten",
  sourceHelp:
    "Bereiten Sie bearbeitbaren Text aus diesem Quellenstand vor. Prüfen Sie ihn für Ihre nächste Aufgabe; die Arbeit wird separat gestartet.",
  guideSource:
    "Gespeicherte Beschreibung des lokalen Projekts #{id}. Vor Wiederverwendung prüfen.",
  preparedGuide: "Leitfaden aus dieser gespeicherten Beschreibung prüfen",
  guideTitleHelp:
    "Der Quelltitel bleibt vollständig erhalten. Kürzen Sie Titel über 120 Zeichen vor dem Speichern selbst. Prüfen Sie Anweisungen und Verfügbarkeit für Agenten.",
  prepareProject: "Projekt vorbereiten",
  disabledGuideHelp:
    "Dieser Leitfaden ist für Agenten deaktiviert. Das Vorbereiten seines Texts ändert diese Einstellung nicht.",
  runtimeHelp:
    "Neue Arbeit nutzt die gewählte Verbindung, Zugriffsregeln und Token-/Kostenlimits dieser Installation. Prüfen Sie vor dem Start die Einstellungen.",
  waitingGuide:
    "Prüfen Sie zuerst den vorherigen Speichervorgang, bevor Sie diesen eingehenden Leitfaden ansehen.",
} satisfies ReusableWorkCopy;
