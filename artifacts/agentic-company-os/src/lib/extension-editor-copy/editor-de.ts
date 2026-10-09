import type { ExtensionEditorCopy } from "../extension-editor-copy";
export default {
  storageError:
    "Dieser Tab konnte den Entwurf oder Speichervorgang nicht sichern oder entfernen. Dein Text bleibt hier; beim Neuladen können ungesicherte Änderungen verloren gehen. Speichern beginnt erst, wenn die Anfrage gesichert ist.",
  pendingTitle: "Diesen Speichervorgang vor erneutem Speichern prüfen",
  uncertain:
    "Die Speicherantwort ist unbestätigt. Dieselbe Anleitungs-ID und gesendete Version bleiben erhalten; es gibt keine automatische Wiederholung.",
  check: "Gespeicherten Inhalt prüfen",
  retry: "Gesendete Speicherung wiederholen",
  continue: "Weiter bearbeiten",
  matching:
    "Aktuell gespeicherte ID, Inhalt, Verfügbarkeit und Revision entsprechen deiner Anfrage. Dies ist eine Inhaltsprüfung, kein Befehlsbeleg.",
  missing:
    "Diese Abfrage fand keine neue gespeicherte Version. Die erste Anfrage kann noch abgeschlossen werden. Wiederholen sendet dieselbe ID, denselben Inhalt und dieselbe erwartete Revision.",
  changed:
    "Die gespeicherte Anleitung unterscheidet sich von deiner Anfrage. Prüfe ihren Inhalt vor dem Fortfahren; es wird nichts erneut gespeichert.",
  invalid:
    "Der gespeicherte Inhalt konnte nicht geprüft werden. Deine gesendete Anfrage bleibt erhalten. Prüfe erneut, sobald die Verbindung verfügbar ist.",
  validation:
    "Korrigiere ID und Pflichtfelder: Titel bis 120 Zeichen, Beschreibung 2.000, Anweisungen oder Code 8.000, JSON-Paket 16.000. Werkzeugvorgaben müssen ein JSON-Objekt sein. Text wird nie automatisch gekürzt.",
  availability: "Nach dem Speichern für Agenten verfügbar",
  incomingHelp:
    "Du hast bereits einen bearbeitbaren Entwurf. Behalte ihn oder ersetze ihn ausdrücklich durch die ausgewählte Anleitung oder den Import.",
  keep: "Aktuellen Editorentwurf behalten",
  use: "Ausgewählte Anleitung verwenden",
  reviewCurrent: "Meine Änderungen mit gespeicherter Revision behalten",
  storedVersion: "Aktuell gespeicherte Anleitung",
  storedAvailability: "In der gespeicherten Version verfügbar",
  reviewHelp:
    "Prüfe den gespeicherten Text unten. Fortfahren behält deinen bearbeitbaren Text und verwendet diese gelesene Revision für späteres ausdrückliches Speichern. Es erteilt keine neue Berechtigung.",
} satisfies ExtensionEditorCopy;
