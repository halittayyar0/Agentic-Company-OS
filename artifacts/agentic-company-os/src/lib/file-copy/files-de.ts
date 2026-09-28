import type { FileCopy } from "../file-copy";
const copy: FileCopy = {
  filesTitle: "Arbeitsdateien",
  filesHelp:
    "Die Projekte dieses Experten teilen sich diese Dateien. Prüfe die aktuelle Version vor dem Speichern.",
  root: "Stammverzeichnis",
  openFile: "Datei öffnen",
  openFolder: "Ordner öffnen",
  newFile: "Neue Datei",
  refreshFiles: "Dateiliste aktualisieren",
  loadingFiles: "Dateien werden geladen…",
  listError: "Das Verzeichnis konnte nicht geladen werden.",
  listStale:
    "Aktualisierung fehlgeschlagen. Das zuletzt geladene Verzeichnis bleibt sichtbar.",
  partialList:
    "Diese Liste ist unvollständig. Höchstens 2.000 Elemente werden geprüft; nicht unterstützte oder unlesbare Elemente können fehlen.",
  emptyList: "Dieses Verzeichnis ist leer.",
  entriesLabel: "Angezeigte Elemente",
  pathLabel: "Relativer Dateipfad",
  pathHelp:
    "Trenne Ordner mit /. Eine neue Datei ersetzt keine vorhandene Datei.",
  pathInvalid:
    "Gib einen relativen Pfad mit höchstens 2.048 Zeichen ein, ohne leere, . oder .. Abschnitte, Rückstriche oder äußere Leerzeichen.",
  create: "Erstellen",
  fileCreated: "Der Server hat die Dateierstellung bestätigt.",
  contentLabel: "Inhalt von {name}",
  save: "Speichern",
  close: "Schließen",
  readError:
    "Die Datei konnte nicht gelesen werden. Dein Entwurf bleibt erhalten.",
  reading: "Datei wird gelesen…",
  readonly:
    "Nur Vorschau. Gekürzte, binäre oder nicht unterstützte Dateien lassen sich hier nicht speichern.",
  contentInvalid:
    "Verwende vollständigen UTF-8-Text ohne NUL-Zeichen mit höchstens 128 KiB. Dein Entwurf wurde nicht gekürzt.",
  snapshotHint:
    "Du bearbeitest eine Momentaufnahme. Der Server prüft die Version beim Speichern erneut.",
  saved: "Der Server hat den gespeicherten Inhalt bestätigt.",
  draftsTitle: "Gespeicherte Entwürfe in diesem Tab",
  resumeDraft: "Entwurf fortsetzen",
  discardDraft: "Entwurf verwerfen",
  discardTitle: "Diesen lokalen Entwurf verwerfen?",
  discardBody:
    "Der lokale Entwurf wird entfernt. Ein Schreibvorgang auf dem Server wird dadurch weder rückgängig gemacht noch abgebrochen.",
  discardConfirm: "Lokalen Entwurf verwerfen",
  reviewTitle: "Dateiversion prüfen",
  reviewHelp:
    "Dein Entwurf bleibt erhalten. Vergleiche vor dem nächsten Speichern die aktuelle Serverdatei.",
  compare: "Aktuelle Datei vergleichen",
  comparisonLabel: "Aktueller Serverinhalt",
  comparisonError:
    "Die aktuelle Datei konnte nicht gelesen werden. Der Entwurf bleibt erhalten; die Prüfung ist unvollständig.",
  reviewCheck:
    "Ich habe den aktuellen Inhalt geprüft. Beim nächsten Speichern darf mein Entwurf diese Version ersetzen.",
  reviewDone: "Prüfung abschließen",
  writeUnknown: "Speicherergebnis unbestätigt",
  writeUnknownHelp:
    "Die Anfrage könnte die Datei verändert haben. Prüfe Inhalt und Serveraktivitäten, bevor du die lokale Warnung entfernst. Das Entfernen wiederholt oder beendet keine Anfrage.",
  writePending: "Anfrage gesendet; warte auf die Dateiantwort…",
  reviewRequest: "Früheren Schreibvorgang prüfen",
  missingFile:
    "Die Datei ist derzeit nicht vorhanden. Das belegt nicht, ob eine frühere Anfrage ausgeführt wurde.",
  fileStorageError:
    "Dieser Tab konnte keine Wiederherstellungsdaten speichern. Bewahre oder kopiere sichtbare Entwürfe vor dem Verlassen. Neue Schreibvorgänge sind gesperrt.",
  fileDamaged:
    "Gespeicherte Dateidaten sind beschädigt. Prüfe frühere Auswirkungen und kopiere sichtbare Entwürfe, bevor du lokale Daten entfernst.",
  fileResetCheck:
    "Ich habe frühere Auswirkungen geprüft und benötigte Entwürfe kopiert. Entferne die Dateientwürfe und Schreibwarnung dieses Tabs.",
  fileReset: "Lokale Dateidaten entfernen",
  fileLocalOnly:
    "Entwürfe und offene Schreibanfragen bleiben auch nach dem Neuladen in diesem Browsertab. Beim Schließen können sie verloren gehen; sie werden nicht mit anderen Geräten geteilt.",
  fileBlocked:
    "Dateiänderungen sind erst möglich, wenn der Sicherheitsstatus es erlaubt.",
  title: "Löschung prüfen",
  remove: "Löschen",
  help: "Alle aufgeführten Elemente werden dauerhaft gelöscht. Bei Änderungen ist eine neue Prüfung nötig. Verhindere, dass andere Programme diese Dateien bearbeiten.",
  inspect: "Aktuellen Umfang prüfen",
  inspecting: "Wird geprüft…",
  scope: "Vollständiger Löschumfang",
  count: "Elemente einschließlich Ziel",
  bytes: "Dateigröße in Byte",
  file: "Datei",
  folder: "Ordner",
  confirm:
    "Ich habe den gesamten Umfang geprüft und verstehe, dass die Löschung nicht rückgängig gemacht werden kann.",
  submit: "Geprüfte Elemente löschen",
  pending: "Warte auf die Antwort zur Löschung…",
  cancel: "Abbrechen",
  success: "Der Server hat die Löschung bestätigt.",
  unknown: "Ergebnis der Löschung unbestätigt",
  unknownHelp:
    "Die Anfrage könnte einen Teil oder das gesamte Ziel gelöscht haben. Prüfe aktuelle Dateien und Serveraktivitäten. Ein Fehler bedeutet nicht, dass die Inhalte erhalten blieben.",
  missing:
    "Das Ziel ist derzeit nicht vorhanden. Das belegt weder, wer es entfernt hat, noch den Abschluss der vorherigen Anfrage.",
  error:
    "Der Umfang konnte nicht geprüft werden. Prüfe Verbindung, Berechtigungen und ob sich die Dateien noch ändern.",
  limited:
    "Dieser Umfang ist hier nicht prüfbar: Er enthält möglicherweise Links oder Spezialdateien oder überschreitet 1.000 Elemente, 64 MiB, 32 Ebenen oder die Prüfzeit. Verwalte ihn auf dem Server.",
  changed:
    "Der Umfang hat sich geändert. Prüfe ihn vor der Löschbestätigung erneut.",
  storageError:
    "Dieser Tab konnte keine Wiederherstellungsdaten speichern. Es wird keine neue Löschanfrage gesendet.",
  damaged:
    "Gespeicherte Löschdaten sind beschädigt. Prüfe frühere Auswirkungen, bevor du diesen lokalen Eintrag löschst.",
  clearConfirm:
    "Ich habe die möglichen Auswirkungen geprüft. Das Entfernen dieser Warnung bricht keine Serveranfrage ab und wiederholt sie nicht.",
  clear: "Lokale Warnung entfernen",
  recover: "Frühere Löschung prüfen",
  localOnly:
    "Die Wiederherstellungsdaten bleiben in diesem Browsertab. Beim Schließen können sie verloren gehen; andere Geräte haben keinen Zugriff darauf.",
  storageRetry: "Lokal erneut speichern",
  blocked: "Löschen ist erst möglich, wenn der Sicherheitsstatus es erlaubt.",
  required: "Bestätige den geprüften Umfang vor dem Löschen.",
};
export default copy;
