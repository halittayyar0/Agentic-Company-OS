import type { MeetingTurnCopy } from "../meeting-turn-copy";
const copy: MeetingTurnCopy = {
  outcomeHelp:
    "Für diese Runde gespeicherte Antworten; keine aktuelle Besprechungsansicht.",
  recordedFailure:
    "Das gespeicherte Ergebnis meldet einen Fehler. Prüfen Sie die Antworten und übersprungenen Experten.",
  skipped: "Experten ohne gespeicherte Antwort",
  skip_busy: "Beschäftigt",
  skip_unavailable: "Nicht verfügbar",
  skip_empty_response: "Keine Antwort erstellt",
  skip_model_error: "Antworterstellung fehlgeschlagen",
  skip_provider_unavailable: "Anbieter nicht verfügbar",
  skip_budget_guard: "Antwortbudget erreicht",
  inboxTitle: "Gespeicherte Besprechungsrunden",
  inboxHelp:
    "Gespeicherte Anfragen dieses Projekts bleiben verfügbar, auch wenn die Besprechung nicht aufgelistet ist. Sie gehören zu diesem Browser-Tab; Löschen bricht keine Serverarbeit ab.",
  meetingId: "Besprechungs-ID",
  participants: "Gespeicherte Teilnehmer-IDs",
  defaultParticipants: "In der gespeicherten Anfrage nicht angegeben",
  noParticipants: "Leere Teilnehmerliste",
  tokenLimit: "Gespeichertes Antwort-Tokenlimit",
  defaultLimit: "Nicht angegeben; Serverstandard",
  damagedTitle: "Beschädigter Rundeneintrag",
  reviewDamaged: "Beschädigten Eintrag prüfen",
  damagedHelp:
    "Der ursprüngliche lokale Inhalt steht unten. Kopieren Sie nötige Belege vor dem Löschen. Aus beschädigten Daten kann keine Anfrage gesendet werden.",
  clearDamaged: "Geprüften lokalen Eintrag löschen",
  clearHelp:
    "Ich habe die nötigen Belege geprüft und gesichert. Das Löschen dieser lokalen Kopie bricht keine angenommene Runde ab und löscht keine Servereinträge.",
  localKey: "Lokaler Speicherschlüssel",
  storageReadError:
    "Gespeicherte Anfragen konnten nicht vollständig gelesen werden. Dies ist kein leerer Posteingang. Stellen Sie den Browserspeicher wieder her und aktualisieren Sie.",
  refreshInbox: "Gespeicherte Einträge aktualisieren",
  changed:
    "Der Eintrag wurde geändert oder konnte nicht gelöscht werden. Aktualisieren und prüfen Sie den aktuellen Eintrag.",
  previous: "Vorherige Einträge",
  next: "Nächste Einträge",
  scanMore: "Weitere gespeicherte Einträge suchen",
  scanIncomplete:
    "Die Speichersuche ist unvollständig. Weitere Anfragen können vorhanden sein; setzen Sie die Suche fort.",
  pageSummary: "Einträge {from}–{to} von {count} gefundenen",
  title: "Besprechungsrunde wiederherstellen",
  help: "Die ursprüngliche Anfrage ist in diesem Browser-Tab gespeichert. Aktualisieren oder Prüfen des Belegs startet keine weitere Runde.",
  prompt: "Gespeicherte Nachricht",
  pending:
    "Die Antwort ist nicht bestätigt. Vor erneutem Senden den gespeicherten Ausgang prüfen.",
  check: "Gespeicherten Ausgang prüfen",
  checking: "Wird geprüft…",
  running: "Die angenommene Runde läuft noch. Später erneut prüfen.",
  notRecorded:
    "Kein Beleg gefunden. Dieselbe Anfrage-ID mit der ursprünglichen Eingabe kann ausdrücklich erneut gesendet werden.",
  retry: "Ursprüngliche Anfrage erneut senden",
  recorded:
    "Die Runde ist beendet und ihr Ausgang gespeichert. Vor dem Fortfahren das Protokoll prüfen.",
  unconfirmed:
    "Der Ausgang der angenommenen Runde ist unbestätigt. Dieselbe ID wird nie erneut ausgeführt.",
  review: "Prüfen und fortfahren",
  reviewHelp:
    "Dies entfernt nur die lokale Markierung und bricht keine Serverarbeit ab. Ein fehlender Beleg beweist nicht, dass die Anfrage nie angenommen wurde. Eine neue Runde kann Arbeit wiederholen oder Modellnutzung verursachen; prüfen Sie zuerst die gespeicherte Eingabe und verfügbare Besprechungsaufzeichnungen.",
  continue: "Aufzeichnungen geprüft",
  cancel: "Wiederherstellung beibehalten",
  storage:
    "Browserspeicher ist nicht verfügbar. Eine neue Runde ist erst möglich, wenn die Anfrage-ID gespeichert werden kann.",
  invalid:
    "Der gespeicherte Wiederherstellungseintrag ist nicht lesbar. Tab beibehalten und den gespeicherten Eintrag vor einer neuen Runde prüfen.",
  loadError:
    "Der Beleg konnte nicht bestätigt werden. Die ursprüngliche Anfrage bleibt gespeichert.",
  recordId: "Anfrage-ID",
  requestFailed:
    "Die Antwort ist unbestätigt. Den gespeicherten Ausgang im Wiederherstellungsbereich prüfen.",
};
export default copy;
