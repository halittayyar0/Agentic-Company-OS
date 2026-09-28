import type { ComputerCopy } from "../computer-copy";
const copy: ComputerCopy = {
  commandRequired: "Geben Sie einen Befehl ein.",
  title: "Computer-Arbeitsbereich",
  agentLabel: "Computer-Arbeitsbereich von {name}",
  scope:
    "Browser, Befehle und Dateien gehören zum gemeinsamen Arbeitsbereich dieses Experten.",
  projectScope:
    "Diese Werkzeuge teilen den Arbeitsbereich des Experten über Projekte hinweg. Hier eingegebene Befehle sind Bedieneraktionen und keine Schritte dieses Projekts.",
  source: "Unveränderter Quellinhalt",
  activity: "Aufgezeichnete Aktivität",
  activityHelp:
    "Bis zu 20 Einträge pro Seite für diesen Experten; sie können zu anderen Arbeiten gehören. Nur die neueste Seite wird automatisch aktualisiert.",
  projectActivityHelp:
    "Bis zu 20 Einträge pro Seite für dieses Projekt. Hier eingegebene Bedienerbefehle sind nicht diesem Projekt zugeordnet.",
  activityEmpty: "Keine Einträge in diesem Ausschnitt.",
  activityError: "Aktivität konnte nicht geladen werden.",
  activityStale:
    "Aktualisierung fehlgeschlagen. Zuvor geladene Einträge bleiben sichtbar.",
  refresh: "Aktualisieren",
  loading: "Wird geladen…",
  ready: "Arbeitsbereich vorhanden",
  notCreated: "Wird bei erster Nutzung erstellt",
  statusError: "Status des Arbeitsbereichs konnte nicht geprüft werden.",
  bytes: "Gespeicherte Bytes",
  files: "Arbeitsdateien",
  folders: "Ordner",
  browser: "Browser",
  terminal: "Terminal",
  surfaces: "Computer-Werkzeuge",
  follow: "Neue Agentenereignisse verfolgen",
  followHelp:
    "Wechselt Werkzeuge nur bei einem neuen Agentenereignis. Ihre Eingabe wird nicht unterbrochen.",
  permissionOff: "Browser-Berechtigung deaktiviert.",
  terminalHelp:
    "Pro Anfrage wird ein Befehl ausgeführt. Arbeitsbereichspfade sind beschränkt; dies ist keine Betriebssystem-Isolation.",
  hostHelp:
    "Host-Befehle nutzen die Betriebssystemrechte des API-Dienstkontos. Der Server muss diesen Modus ausdrücklich aktivieren.",
  host: "Host-Bediener",
  workspace: "Arbeitsbereich",
  command: "Befehl",
  run: "Befehl ausführen",
  keyboard:
    "Enter fügt eine Zeile ein. Strg/Befehl+Enter führt außerhalb der Texteingabekomposition aus.",
  tooLong:
    "Der Befehl überschreitet 32.768 Zeichen. Der Entwurf wurde nicht gekürzt.",
  disabled: "Terminal-Berechtigung deaktiviert.",
  blocked: "Befehle bleiben gesperrt, bis der Sicherheitsstatus sie zulässt.",
  cwdLoading: "Arbeitsverzeichnis wird geprüft…",
  cwdError:
    "Arbeitsverzeichnis konnte nicht geprüft werden. Vor der Ausführung aktualisieren.",
  folder: "Arbeitsverzeichnis",
  running: "Anfrage gesendet; Ergebnis wird erwartet…",
  unconfirmed: "Befehlsergebnis unbestätigt",
  unconfirmedHelp:
    "Die Aktion wurde möglicherweise ausgeführt. Das Ergebnis ist weiterhin unbestätigt. Die Prüfung liest nur den Eintrag dieser Anfrage. Sie wiederholt oder storniert keine Aktion.",
  reviewCheck:
    "Ich habe mögliche Auswirkungen geprüft. Fortfahren entfernt nur diese lokale Warnung und bricht den Befehl weder ab noch wiederholt es ihn.",
  reviewDone: "Prüfung abschließen",
  storageError:
    "Wiederherstellungsdaten konnten in diesem Tab nicht gespeichert werden. Ihr Entwurf bleibt sichtbar; neue Befehle sind gesperrt.",
  storageRetry: "Lokal erneut speichern",
  damaged:
    "Gespeicherte Terminaldaten sind beschädigt. Prüfen Sie den vorherigen Befehl, bevor Sie diesen lokalen Eintrag löschen.",
  localOnly:
    "Entwürfe und die letzte Antwort bleiben auch beim Neuladen in diesem Browser-Tab. Beim Schließen können sie verloren gehen. Sie werden nicht mit Ihrem Telefon oder anderen Geräten geteilt.",
  result: "Aufgezeichnete Befehlsantwort",
  output: "Befehlsausgabe",
  emptyOutput: "Keine Ausgabe zurückgegeben.",
  copy: "Ausgabe kopieren",
  copied: "Kopiert",
  copyError:
    "Kopieren fehlgeschlagen. Sie können die Ausgabe manuell auswählen.",
  clearOutput: "Sichtbare Ausgabe leeren",
  reuse: "Befehl als Entwurf verwenden",
  exit: "Exit-Code",
  duration: "Dauer",
  latest: "Letztes Ergebnis",
  historyHelp:
    "Höchstens 6 letzte Antworten werden angezeigt; nur die letzte wird für die Wiederherstellung beim Neuladen gespeichert.",
};
export default copy;
