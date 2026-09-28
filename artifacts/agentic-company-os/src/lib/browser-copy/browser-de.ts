import type { BrowserCopy } from "../browser-copy";
const copy: BrowserCopy = {
  zoomIn: "Originalgröße",
  zoomOut: "Bild einpassen",
  title: "Browser",
  help: "Prüfen Sie den Browser des Agenten und übernehmen Sie die Steuerung. Die Ansicht zeigt regelmäßig aktualisierte Bildschirmbilder.",
  address: "Webadresse",
  go: "Adresse öffnen",
  addressInvalid:
    "Geben Sie eine HTTP- oder HTTPS-Adresse ohne eingebettete Zugangsdaten ein.",
  take: "Steuerung übernehmen",
  release: "Steuerung zurückgeben",
  ownerAgent: "Der Agent steuert den Browser",
  ownerOperator: "Sie steuern den Browser",
  ownerOther:
    "Bedienersteuerung aktiv; Ihre Berechtigung ist in diesem Tab nicht bestätigt.",
  agentBusy:
    "Warten Sie, bis die laufende Browseraktion des Agenten beendet ist.",
  blocked:
    "Browseränderungen sind bis zur Freigabe durch die Sicherheitskontrollen pausiert.",
  loading: "Browser wird geprüft…",
  refresh: "Bild aktualisieren",
  pause: "Bilder pausieren",
  resume: "Bilder fortsetzen",
  polling: "Bilder werden regelmäßig aktualisiert",
  paused: "Bilder pausiert · Eingabe gesperrt",
  syncLost:
    "Das neueste Bild konnte nicht bestätigt werden. Die Eingabe ist gesperrt; das letzte Bild bleibt sichtbar.",
  received: "Bild empfangen",
  empty:
    "Keine Browsersitzung. Übernehmen Sie die Steuerung und öffnen Sie eine Adresse.",
  imageLabel: "Browserbild",
  frameHelp:
    "Klicken Sie im Bild auf das Ziel. Tab verlässt das Bild; Escape fokussiert die Steuerungstaste. Verwenden Sie die Tasten darunter für den entfernten Browser. Das Bild macht die entfernte Seite nicht für Screenreader zugänglich.",
  textLabel: "Text für das ausgewählte entfernte Feld",
  textHelp:
    "Wählen Sie ein Feld im Bild, verfassen Sie hier den Text und senden Sie ihn. Enter fügt einen Zeilenumbruch ein. Passwörter sind hier sichtbar; leeren Sie den Entwurf anschließend.",
  textInvalid:
    "Geben Sie 1–4096 UTF-16-Codeeinheiten ohne NUL oder unvollständige Unicode-Zeichen ein.",
  send: "Text senden",
  busy: "Warten auf die Antwort des Browsers…",
  sent: "Browseraktion bestätigt.",
  unknown: "Das Ergebnis der Aktion ist unbekannt.",
  unknownHelp:
    "Keine automatische Wiederholung. Aktualisieren und prüfen Sie die entfernte Seite, bevor Sie fortfahren. Diese lokale Markierung enthält weder Text noch Adresse und ist kein Serverbeleg.",
  review: "Aktuelles Bild prüfen",
  reviewCheck:
    "Ich habe die aktuelle Seite geprüft und verstehe, dass die vorherige Aktion stattgefunden haben kann.",
  reviewDone: "Prüfung abschließen",
  reviewRequired:
    "Prüfen Sie die unklare Aktion, bevor Sie eine weitere senden.",
  error:
    "Die Anfrage wurde abgelehnt. Aktualisieren Sie das Bild und prüfen Sie die Steuerung.",
  close: "Browser schließen",
  closeTitle: "Diese Browsersitzung schließen?",
  closeHelp:
    "Die entfernte Seite und ihre ungespeicherten Daten werden geschlossen. Dafür ist Ihre aktuelle Steuerungsberechtigung nötig.",
  cancel: "Abbrechen",
  confirm: "Sitzung schließen",
  fullscreen: "Vollbild",
  exitFullscreen: "Vollbild verlassen",
  fullscreenError: "Vollbild ist in diesem Browser nicht verfügbar.",
  back: "Zurück",
  forward: "Vorwärts",
  reload: "Seite neu laden",
  tab: "Nächstes Feld",
  shiftTab: "Vorheriges Feld",
  enter: "Eingabe",
  backspace: "Rücktaste",
  escape: "Escape",
  up: "Aufwärts",
  down: "Abwärts",
  left: "Links",
  right: "Rechts",
  scrollUp: "Nach oben scrollen",
  scrollDown: "Nach unten scrollen",
  storageError:
    "Der lokale Wiederherstellungsspeicher ist nicht verfügbar. Neue Aktionen bleiben gesperrt.",
  retryStorage: "Lokalen Speicher erneut prüfen",
  damaged:
    "Die lokale Wiederherstellungsmarkierung ist unlesbar. Prüfen Sie die aktuelle Seite, bevor Sie sie löschen.",
  draftsHint:
    "Text- und Adressentwürfe bleiben nur im Speicher dieses Tabs. Kopieren Sie sie vor dem Neuladen oder Schließen.",
  windowVisible: "Fenster auf dem Host sichtbar",
  windowHidden: "Browser läuft im Hintergrund",
};
copy.unknownHelp += " Die Aktion kann noch später abgeschlossen werden.";
export default copy;
