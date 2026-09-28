import type { ProjectStudioCopy } from "../project-studio-copy";
const copy: ProjectStudioCopy = {
  answerHeading: "{name} wartet auf deine Antwort",
  answerHelp:
    "Prüfe die Frage. Deine Antwort stellt die Aufgabe zur Fortsetzung in die Warteschlange.",
  answerLabel: "Deine Antwort",
  answerPlaceholder:
    "Schreibe deine Entscheidung oder die fehlenden Informationen…",
  answerDraft:
    "Dein Entwurf bleibt nach dem Neuladen in diesem Browser-Tab erhalten. Gib keine Zugangsdaten ein.",
  answerRequired: "Gib eine Antwort ein.",
  answerLong: "Verwende höchstens 1.200 Zeichen.",
  answerSend: "Antwort senden und fortsetzen",
  answerSending: "Antwort wird gesendet…",
  answerAccepted:
    "Antwort gespeichert. Die Aufgabe wurde zur Fortsetzung eingereiht.",
  answerUnknown:
    "Die Zustellung ist unbestätigt. Dein Text bleibt erhalten; prüfe zuerst den gespeicherten Beleg.",
  answerCheck: "Zustellung prüfen",
  answerNotRecorded:
    "Noch kein gespeicherter Beleg. Die Anfrage könnte noch laufen. Du kannst dieselbe Antwort sicher erneut senden.",
  answerRetry: "Dieselbe Antwort erneut senden",
  answerStorage:
    "Die Wiederherstellungsdaten konnten nicht gespeichert werden. Nichts wurde gesendet. Kopiere deine Antwort und aktiviere den Browserspeicher.",
  answerUnavailable:
    "Diese Aufgabe hat derzeit keine beantwortbare Frage. Aktualisiere zur erneuten Prüfung.",
  answerChanged:
    "Die Frage hat sich geändert. Dein Entwurf bleibt erhalten. Öffne die aktuelle Frage und prüfe deine Antwort.",
  answerReview: "Aktuelle Frage öffnen",
  answerRejected: "Der Server hat diese Antwort nicht angenommen.",
  answerTaskChanged:
    "Aufgabe oder Zuständigkeit geändert. Aktualisiere vor dem Fortfahren.",
  answerOwnerInactive: "Der zuständige Agent ist inaktiv.",
  answerEmergency: "Der Not-Aus ist aktiv. Aktualisiere nach seiner Aufhebung.",
  answerQuestionLabel: "Gespeicherte Frage",
  answerQuestionError:
    "Die Frage konnte nicht geladen werden. Dein Entwurf bleibt erhalten.",
  answerPendingHelp:
    "Die gespeicherte Antwort bleibt bis zur Klärung gesperrt. Eine Prüfung sendet sie nicht erneut.",
  unavailable: "Nicht verfügbar",
  recordsMissing: "Aktivitätsaufzeichnungen konnten nicht geladen werden.",
  tasksMissing: "Unteraufgaben konnten nicht geladen werden.",
  tasksLoading: "Unteraufgaben werden geladen…",
  tasksStale:
    "Unteraufgaben konnten nicht aktualisiert werden. Die zuletzt abgerufene Liste bleibt sichtbar.",
  completedWork: "Abgeschlossene geladene Unteraufgaben",
  recordStatus: "Gespeicherter Status",
  invalidTitle: "Ungültige Projektadresse",
  invalidHelp: "Dieser Link enthält keine gültige Projekt-ID.",
  missingTitle: "Projekt nicht gefunden",
  missingHelp: "Projekt #{id} wurde möglicherweise gelöscht oder nie erstellt.",
  loadError: "Projekt konnte nicht geladen werden",
  loadHelp:
    "Die Projektdaten konnten nicht abgerufen werden. Verbindung prüfen und erneut versuchen.",
  stale:
    "Aktualisierung fehlgeschlagen. Das zuletzt geladene Projekt bleibt sichtbar; vor einer Aktion den aktuellen Stand prüfen.",
  snapshot: "Zuletzt abgerufen: {time}",
  retry: "Erneut versuchen",
  back: "Zurück zu Projekten",
  parent: "Übergeordnetes Projekt",
  operations: "Projektbetrieb",
  stop: "Stoppen",
  stopTitle: "Diese Arbeit stoppen?",
  stopHelp:
    "„{title}“ und aktive Unteraufgaben stoppen. Bereits erfolgte externe Wirkungen bleiben bestehen; Aufzeichnungen bleiben erhalten.",
  dismiss: "Abbrechen",
  confirmStop: "Arbeit stoppen",
  stopping: "Warten auf das Stoppergebnis…",
  stopped: "Stopp gespeichert",
  unknownStop: "Stoppergebnis nicht bestätigt",
  unknownHelp:
    "Die Anfrage kann den Server erreicht haben. Eine Statusprüfung sendet keine weitere Stoppanfrage.",
  checkState: "Status prüfen",
  checking: "Wird geprüft…",
  activeAfterCheck:
    "Die letzte Prüfung zeigt aktive Arbeit. Das Ergebnis der früheren Anfrage ist unbekannt. Ein weiterer Stopp kann separat bestätigt werden.",
  reviewStop: "Erneuten Stopp prüfen",
  terminalObserved:
    "Serverstatus: {status}. Diese Prüfung allein belegt nicht das Ergebnis der früheren Anfrage.",
  storageError:
    "Die Stoppnotiz konnte in diesem Tab nicht gespeichert werden; keine Anfrage gesendet. Browserspeicher prüfen.",
  continuous: "Fortlaufend · {count} Zyklen",
  finite: "Begrenzte Arbeit",
  mode: "Modus {name}",
  low: "Niedrig",
  normal: "Normal",
  high: "Hoch",
  urgent: "Dringend",
  warning: "Letzte Arbeitswarnung",
  source: "Originaler Aufzeichnungstext",
  nextAttempt: "Nächster Versuch: {time}",
  partial: "Einige Projektdaten sind nicht verfügbar: {sections}.",
  plan: "Arbeitsplan",
  experts: "Expertenliste",
  team: "Projektteam",
  chatMissing: "Projektgespräch nicht verfügbar",
  ownerMissing:
    "Die Koordination konnte nicht bestätigt werden. Aktuelle Projekt- und Teamdaten prüfen.",
  members: "Teammitglieder: {count}",
  memberLabel: "Mitglieder des Projektteams",
  emptyTeam: "Noch keine Teamdaten verfügbar.",
  coordinatorHelp:
    "{name} koordiniert die Arbeit; sie steht dem gesamten Team offen.",
  loading: "Projektstudio wird geladen",
  tabs: "Projektansichten",
  workspace: "Arbeitsbereich",
  planTab: "Plan und Verlauf",
  meetings: "Besprechungen",
  teamTab: "Team",
  evidence: "Ergebnis",
  rosterHelp: "Das gespeicherte Team dieses Projekts",
  coordinator: "Koordination",
  workCount: "Aufgaben: {count}",
  inTeam: "Teammitglied",
  inactive: "Inaktiv",
  planHelp: "Gespeicherte Unteraufgaben und ihr zuletzt geladener Status",
  steps: "Schritte: {count}",
  noTasks: "Noch keine Unteraufgaben",
  noTasksHelp:
    "Der Plan erscheint hier, sobald seine Aufgaben gespeichert werden.",
  expertId: "Experte #{id}",
  records: "Aktivitätsaufzeichnungen",
  recordsHelp:
    "Die letzten {count} vom Server gespeicherten Aktivitäten. Ältere Einträge sind möglicherweise nicht enthalten.",
  recordsLoading: "Aufzeichnungen werden geladen",
  recordsError:
    "Aktivitäten konnten nicht aktualisiert werden. Die zuletzt geladenen Einträge bleiben sichtbar.",
  noRecords: "Noch keine Arbeitsaufzeichnungen",
  runSummary: "Gespeicherte Übersicht",
  progress: "Fortschritt",
  attempts: "Arbeitsversuche",
  tokens: "Tokens",
  model: "Gespeichertes Modell",
  unknownModel: "Kein Modell gespeichert",
  deliverySummary: "Ergebnisübersicht",
  noDelivery:
    "Noch keine Ergebnisübersicht gespeichert. Sie erscheint nach dem Speichern hier.",
};
export default copy;
