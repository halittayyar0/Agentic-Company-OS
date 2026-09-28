import type { ExpertChatCopy } from "../expert-chat-copy";
export default {
  projectTitle: "Projektgespräch",
  projectHelp:
    "Nachrichten und jüngster Kontext gehören zu diesem Projekt und seiner Koordination. Bestehende Werkzeugrechte und Genehmigungspflichten gelten weiterhin.",
  projectPrompt: "Prüfe das Projektziel und schlage den nächsten Schritt vor.",
  projectUnavailable:
    "Dieses Projekt ist nicht verfügbar oder die Koordination hat sich geändert. Aktualisiere das Projekt vor einer neuen Anfrage.",
  required: "Gib eine Nachricht ein.",
  title: "Unterhaltung",
  help: "Stellen Sie Fragen oder reihen Sie Arbeit für diesen Experten ein. Werkzeugrechte und Freigaben gelten weiterhin.",
  history: "Unterhaltungsverlauf",
  empty: "Eine Unterhaltung beginnen",
  emptyHelp:
    "Nachrichten werden auf dem Server gespeichert. Das Modell erhält den jüngsten Kontext, kein unbegrenztes Gedächtnis.",
  loading: "Nachrichten werden geladen…",
  historyError: "Der Verlauf konnte nicht geladen werden.",
  historyStale:
    "Der Verlauf konnte nicht aktualisiert werden. Die zuletzt geladenen Nachrichten bleiben sichtbar.",
  refresh: "Verlauf aktualisieren",
  older: "Ältere Nachrichten laden",
  olderError:
    "Ältere Nachrichten konnten nicht geladen werden. Die aktuelle Ansicht bleibt erhalten.",
  windowLimit:
    "Es werden höchstens 500 Nachrichten angezeigt. Wechseln Sie zu den neuesten Nachrichten, um neue Aktivitäten zu verfolgen.",
  latest: "Neueste Nachrichten anzeigen",
  newMessages: "Neue Nachrichten verfügbar",
  you: "Sie",
  system: "Systemeintrag",
  model: "Aufgezeichnetes Modell",
  copy: "Nachricht kopieren",
  copied: "Kopiert",
  copyError:
    "Kopieren fehlgeschlagen. Markieren Sie den Nachrichtentext zum Kopieren.",
  unsafeLink: "Unsicherer Link blockiert",
  mode: "Anfragetyp",
  ask: "Fragen",
  delegate: "Arbeit zuweisen",
  continuous: "Laufende Verantwortung",
  askHelp:
    "Eine Gesprächsrunde; der Experte kann erlaubte Werkzeuge verwenden.",
  delegateHelp:
    "Ein Projekt mit einem definierten Ergebnis einreihen. Eingereihte Arbeit muss noch nicht gestartet sein.",
  continuousHelp:
    "Wiederkehrende Arbeit im Stundenrhythmus einreihen. Die Ausführung hängt vom Worker und den Freigaben ab.",
  instruction: "Nachricht oder Arbeitsbeschreibung",
  placeholder: "Beschreiben Sie Ihre Frage oder das gewünschte Ergebnis…",
  send: "Anfrage senden",
  keyboard: "Enter fügt eine Zeile ein. Strg/⌘ + Enter sendet.",
  tooLong: "Der Text überschreitet das Limit des gewählten Anfragetyps.",
  blocked:
    "Neue Arbeit pausiert, bis der Sicherheitsstatus sie erlaubt. Sie können weiterhin schreiben und gespeicherte Ergebnisse lesen.",
  unavailable:
    "Aktualisieren und prüfen Sie die Expertenkonfiguration vor dem Senden. Archivierte Experten können keine neue Arbeit starten.",
  draftLocal:
    "Ungesendeter Text bleibt in diesem Browser-Tab. Beim Schließen kann er verloren gehen.",
  storageError:
    "Der lokale Eintrag konnte nicht gespeichert oder gelöscht werden. Kopieren Sie Ihren Text; Senden bleibt gesperrt, bis die Speicherung funktioniert.",
  sending: "Warten auf den Server…",
  unconfirmed: "Ergebnis noch unbestätigt",
  unconfirmedHelp:
    "Die Anfrage läuft möglicherweise noch oder wurde unterbrochen. Das Prüfen des Eintrags führt sie nicht erneut aus.",
  check: "Gespeichertes Ergebnis prüfen",
  checking: "Wird geprüft…",
  missing:
    "Noch kein gespeichertes Ergebnis gefunden. Eine bereits gesendete Anfrage kann noch eintreffen.",
  recover: "Dieselbe Anfrage wiederherstellen",
  recoverHelp:
    "Verwendet die ursprüngliche Kennung und Einstellungen. Wenn der Server sie nie gespeichert hat, kann die gespeicherte Anfrage einmal gestartet werden.",
  readError:
    "Das gespeicherte Ergebnis konnte nicht gelesen werden. Behalten Sie die Kennung und prüfen Sie erneut.",
  rejected: "Die Anfrage wurde vor der Ausführung abgelehnt.",
  configChanged:
    "Die Expertenkonfiguration hat sich geändert. Aktualisieren und prüfen Sie sie vor einer neuen Anfrage.",
  busy: "Der Experte arbeitet bereits. Diese Anfrage wurde nicht angenommen.",
  capacity:
    "Die Kapazität des Arbeitsbereichs ist erreicht. Prüfen Sie bestehende Arbeit vor einer neuen Anfrage.",
  invalid:
    "Der Server konnte diese Anfrage nicht annehmen. Prüfen Sie den ursprünglichen Text und die Auswahl.",
  conflict:
    "Diese Kennung passt nicht zur gespeicherten Anfrage. Prüfen Sie die Einträge vor dem Fortfahren.",
  receipt: "Sendebeleg",
  done: "Antwort gespeichert",
  queued: "Projekt eingereiht",
  systemResult: "Runde mit Systemhinweis beendet",
  project: "Projekt öffnen",
  operations: "Betrieb öffnen",
  continue: "Weiter",
  review: "Vor dem Fortfahren prüfen",
  reviewHelp:
    "Das Entfernen des ausstehenden Eintrags aus diesem Tab bricht die Serverarbeit nicht ab. Eine neue Anfrage könnte Aktionen wiederholen. Prüfen Sie zuerst Verlauf, Projekte und Werkzeugbelege.",
  acknowledge:
    "Ich habe die Einträge geprüft und verstehe, dass eine neue Anfrage Aktionen wiederholen kann.",
  cancel: "Abbrechen",
  activity: "Zuletzt aufgezeichnete Aktivitäten",
  activityHelp:
    "Die letzten 12 Ereignisse dieses Experten. Sie können zu anderer Arbeit gehören und belegen weder die laufende Ausführung noch den Abschluss dieser Anfrage.",
  activityEmpty: "Keine jüngsten Aktivitäten aufgezeichnet.",
  activityError:
    "Aktivitäten konnten nicht aktualisiert werden. Sichtbare Einträge können älter sein.",
  source: "Originaltext des Eintrags",
  prompt: "Beschreibe deine Rolle, Fähigkeiten und Grenzen.",
} satisfies ExpertChatCopy;
