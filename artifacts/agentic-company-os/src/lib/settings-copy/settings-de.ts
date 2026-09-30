import type { SettingsCopy } from "../settings-copy";
const copy: SettingsCopy = {
  title: "Verbindungen und Einstellungen",
  description:
    "Modellzugriff, Sprache und Darstellung des Arbeitsbereichs verwalten.",
  preferences: "Deine Einstellungen",
  appearance: "Darstellung",
  light: "Hell",
  dark: "Dunkel",
  system: "Geräteeinstellung",
  appearanceHelp: "Die Darstellung wird in diesem Browser gespeichert.",
  providers: "Modellanbieter",
  credentialHelp:
    "Ein hinterlegter Schlüssel bestätigt keine funktionierende Verbindung. Zuerst speichern, danach ein Modell ausdrücklich testen.",
  key: "Neuer API-Schlüssel",
  sourceRuntime: "Gespeicherter Schlüssel",
  sourceEnvironment: "Schlüssel aus der Serverumgebung",
  sourceNone: "Kein Schlüssel hinterlegt",
  save: "Schlüssel speichern",
  remove: "Gespeicherten Schlüssel entfernen",
  removeHelp:
    "Den in der Anwendung gespeicherten Schlüssel entfernen? Ein Schlüssel aus der Serverumgebung wird dann aktiv, sofern vorhanden. Laufende Anfragen können noch mit dem bisherigen Schlüssel enden.",
  storedLocal:
    "Schlüssel liegen in einer lokalen Serverdatei ohne Verschlüsselung durch die Anwendung. Schütze das Serverkonto und die Sicherungen.",
  storedDatabase:
    "Schlüssel werden in der gemeinsamen Datenbank verschlüsselt. Worker übernehmen Änderungen asynchron; diese Seite bestätigt nicht die Übernahme durch alle Worker.",
  serverManaged: "Auf dem Server verwaltet",
  serverHelp:
    "Konfiguriere diesen Anbieter auf dem Server. Diese Seite ändert seine Servereinstellungen nicht.",
  unavailable: "Im aktuellen Katalog nicht verfügbar",
  test: "Modell testen",
  testHelp:
    "Eine kurze Eingabe wird an den gewählten Anbieter gesendet und kann Kosten verursachen. Die Ausgabe ist auf 10 Token begrenzt; der Server wartet höchstens 20 Sekunden und wiederholt die Anfrage nicht automatisch. Ein Zeitlimit beweist nicht, dass der Anbieter die Verarbeitung beendet hat.",
  confirmTest: "Testanfrage senden",
  cancel: "Abbrechen",
  saved:
    "Der Server hat das Speichern bestätigt. Modellzugriff und Übernahme durch Worker wurden damit nicht geprüft.",
  changed:
    "Die Einstellungen wurden anderswo geändert. Vor dem nächsten Versuch aktualisieren und prüfen.",
  unconfirmed:
    "Das Speichern konnte nicht bestätigt werden. Die Änderung kann bereits wirksam sein. Vor erneutem Senden den Serverstand aktualisieren und prüfen. Dein Entwurf bleibt nur auf dieser Seite.",
  refresh: "Einstellungen aktualisieren",
  busy: "Wird verarbeitet…",
  draftHelp:
    "Schlüsselentwürfe werden nicht im Browserspeicher abgelegt. Verlassen oder Neuladen der Seite löscht sie.",
  loading: "Anbietereinstellungen werden geladen…",
  loadError:
    "Anbietereinstellungen konnten nicht geladen werden. Schlüssel- und Verbindungsstatus sind unbekannt.",
  stale:
    "Zuletzt geladene Einstellungen werden angezeigt. Vor Änderungen oder Tests erfolgreich aktualisieren.",
  rateLimited:
    "Zu viele Anfragen. Warte eine Minute und aktualisiere vor dem nächsten Versuch.",
  testFailed:
    "Der Test konnte nicht bestätigt werden. Der Anbieter kann die Anfrage verarbeitet oder berechnet haben. Es wurde keine automatische Wiederholung gesendet.",
  testPassed: "Dieses Modell hat auf den Test geantwortet.",
  chatOnlyProjectWarning:
    "Agentenprojekte benötigen ein Modell mit Werkzeugunterstützung.",
  chatTestOnly:
    "Diese Antwort bestätigt nur den Chat, nicht die Bereitschaft für Agentenaufgaben.",
  toolTestNext:
    "Dieses Modell ist als werkzeugfähig gelistet und hat geantwortet. Prüfe dein Projekt auf den nächsten Versuch.",
  viewProjects: "Projekte anzeigen",
  testHistorical:
    "Das Ergebnis gilt für die angezeigte Einstellungsversion. Es ist keine laufende Überwachung oder Garantie für andere Modelle.",
  testBlocked:
    "Tests sind bei aktivem oder unbekanntem Notstoppstatus nicht verfügbar.",
  revision: "Einstellungsversion",
  selectedModel: "Zu testendes Modell",
  catalog: "Modellkatalog",
  catalogHelp:
    "Modelle und Beschreibungen stammen aus dem Serverkatalog. Verfügbarkeit, Preise und Grenzen können sich ändern; prüfe sie vor der Nutzung beim Anbieter.",
  search: "Modelle suchen",
  tools: "Werkzeugunterstützung",
  chatOnly: "Nur Chat",
  economy: "Sparsam",
  standard: "Standard",
  premium: "Premium",
  reasoning: "Schlussfolgern",
  freeIdentifier: "Kennung für kostenlosen Tarif; Anbietergrenzen prüfen",
  defaultModel: "Standardmodell",
  more: "Weitere Modelle anzeigen",
  empty: "Keine Modelle entsprechen der Suche.",
  source: "Originalbeschreibung aus dem Katalog",
  runtime: "Serverbetrieb",
  browserHelp:
    "Die Sichtbarkeit des Browsers wird beim Serverstart festgelegt. Diese Seite liest oder ändert den aktuellen Modus nicht.",
  hostHelp:
    "Host-Befehle laufen mit den Betriebssystemrechten des Dienstkontos, ohne Isolation oder Rechteerweiterung. Lasse diese Funktionen aus, sofern der Host nicht isoliert ist und du den gewährten Zugriff nicht verstehst.",
  hostSettings:
    "Host-Ausführung ist standardmäßig deaktiviert. Serverkonfiguration:",
  clear: "Suche löschen",
  removeTitle: "Diesen gespeicherten Schlüssel entfernen?",
  notTested: "Kein Testergebnis bei diesem Besuch",
  elapsed: "Antwortzeit (ms)",
  currentChanged:
    "Dieses Ergebnis gehört zu einer älteren Einstellungsversion.",
  noDescription: "Keine Beschreibung vorhanden.",
};
export default copy;
