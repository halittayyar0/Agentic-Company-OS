import type { OperatorCopy } from "../operator-copy";
const copy: OperatorCopy = {
  check: "Servereintrag prüfen",
  checking: "Servereintrag wird geprüft…",
  help: "Die Prüfung liest nur den Eintrag dieser Anfrage. Sie wiederholt oder storniert keine Aktion.",
  legacy:
    "Dieser ältere lokale Eintrag hat keine Kennung für die Wiederherstellung vom Server. Prüfen Sie die Auswirkungen vor dem Entfernen.",
  reserved:
    "Der Server hat die Anfrage gespeichert; ihre Ausführung wurde noch nicht angestoßen oder bestätigt.",
  dispatched:
    "Die Übergabe zur Ausführung wurde gespeichert; das Ergebnis ist noch unbestätigt.",
  complete: "Der Server hat den Abschluss gespeichert.",
  unavailable:
    "Die Aktion wurde abgeschlossen, aber ihre gespeicherte Ausgabe ist nicht verfügbar. Wiederholen Sie sie nicht allein zum Abrufen der Ausgabe.",
  not_dispatched:
    "Laut Server wurde diese Anfrage nicht zur Ausführung übergeben.",
  unknown:
    "Die Aktion wurde möglicherweise ausgeführt. Das Ergebnis ist weiterhin unbestätigt.",
  missing:
    "Kein passender Eintrag gefunden. Das beweist nicht, dass die Aktion nie ausgeführt wurde.",
  error:
    "Der Servereintrag konnte nicht geprüft werden. Behalten Sie die Warnung und prüfen Sie erneut.",
  browser:
    "Ein gespeicherter Browsereintrag stellt keine Steuerung wieder her. Prüfen Sie die aktuelle Seite, bevor Sie erneut übernehmen.",
  review: "Lokale Warnung prüfen",
  reviewHelp:
    "Prüfen Sie mögliche Auswirkungen, bevor Sie die Warnung dieses Tabs entfernen. Das Entfernen stoppt oder wiederholt keine Aktion.",
  reviewCheck:
    "Ich habe die Auswirkungen geprüft und verstehe, dass nur diese lokale Warnung entfernt wird.",
  finish: "Lokale Warnung entfernen",
  cancel: "Abbrechen",
  changed:
    "Der Eintrag wurde geändert oder konnte nicht gespeichert werden. Schließen Sie den Dialog, prüfen Sie den aktuellen Eintrag und versuchen Sie es erneut.",
};
export default copy;
