import type { ConnectionCopy } from "../connection-copy";
export default {
  apiProviders: "API-Anbieter",
  signedOut:
    "Dieses Konto ist abgemeldet. Melde dich vor der Nutzung erneut an.",
  signInAgain: "Erneut anmelden",
  clearAttempt: "Beendete Anmeldung entfernen",
  description:
    "Dein Auftrag bleibt hier, während du die Verbindung einrichtest. Bereits wartende Aufträge können nach dem Speichern weiterlaufen.",
  local: "Lokales Modell",
  localHint: "Nutze Ollama auf diesem Computer oder einem privaten Server.",
  chatgptHint:
    "Nutze einen berechtigten ChatGPT-Tarif; Berechtigungen und Kontingente gelten weiterhin.",
  api: "API-Schlüssel",
  apiHint:
    "Verbinde OpenAI oder OpenRouter mit deinem Schlüssel. Gebühren des Anbieters können anfallen.",
  back: "Alle Verbindungsoptionen",
  endpoint: "Ollama-Adresse",
  endpointHint:
    "Das Backend greift auf diese Adresse zu, nicht dein Telefon. Verwende einen privaten HTTP(S)-Endpunkt.",
  save: "Verbindung speichern",
  restore: "Installationsstandard verwenden",
  restoreHint:
    "Entfernt die gespeicherte Adresse. Eine Umgebungsadresse bleibt aktiv.",
  key: "API-Schlüssel",
  keyHint:
    "Der Schlüssel bleibt bis zur sicheren Speicherung im Backend im Arbeitsspeicher. Er wird nicht im Browserspeicher abgelegt.",
  saved:
    "Verbindung gespeichert. Die gefundenen Modelle wurden noch nicht mit einer Modellanfrage getestet.",
  unconfirmed:
    "Das Speichern konnte nicht bestätigt werden. Prüfe die aktuelle Verbindung, bevor du erneut speicherst.",
  invalid: "Prüfe Adresse oder Schlüssel und versuche es erneut.",
  changed:
    "Die Verbindung hat sich geändert. Lies vor dem erneuten Speichern den aktuellen Stand.",
  discovered: "Gefundene Modelle",
  none: "Noch kein Modell mit Werkzeugen verfügbar. Prüfe den Anbieter; füge bei Ollama ein Modell hinzu und prüfe erneut.",
  tools: "Werkzeuge verfügbar",
  chatOnly: "Nur Chat",
  advanced: "Erweiterte Einstellungen und ausdrücklicher Modelltest",
  done: "Zurück zu meinem Auftrag",
  accounts: "Gespeicherte Konten",
  noAccounts: "Noch kein gespeichertes Konto.",
  selected: "Ausgewählt",
  select: "Dieses Konto auswählen",
  identityOnly:
    "Nur zur Identifikation angemeldet. Erteile die Tarifberechtigung, um Modelle zu verwenden.",
  planReady:
    "Tarifberechtigung erteilt. Verfügbarkeit und Kontingent werden beim Ausführen geprüft.",
  paused:
    "Tarifnutzung pausiert. Prüfe das Limit, bevor du einen Auftrag erneut versuchst.",
  signIn: "Mit ChatGPT fortfahren",
  sameComputer: "Browser und Backend laufen auf demselben Computer.",
  officialLink: "Offizielle Anmeldung öffnen",
  pending:
    "Anmeldung wartet. Schließe sie auf der offiziellen Seite ab und prüfe dann den Status.",
  review:
    "Prüfe dieses Konto vor dem Speichern. Speichern wählt es nicht aus und startet keinen Auftrag.",
  confirm: "Geprüftes Konto speichern",
  cancel: "Anmeldung abbrechen",
  connected: "Konto gespeichert. Wähle es ausdrücklich aus, um es zu nutzen.",
  ended:
    "Diese Anmeldung ist beendet. Die bisherige Kontoauswahl bleibt bestehen.",
  handoffTitle: "Telefon, Server oder Container",
  handoffText:
    "Ein entfernter Browser erreicht den privaten Rückruf des Backends nicht. Melde dich auf deinem Computer an und übertrage den geschützten Eintrag anhand der Anleitung zum Server. Füge hier keine Zugangsdaten ein.",
  handoffGuide: "Anleitung zur sicheren Übertragung öffnen",
  enablePlan: "Tarifberechtigung erteilen",
  refresh: "Aktuelle Verbindung prüfen",
  unknown:
    "Das Ergebnis ist unbestätigt. Lies den aktuellen Stand, statt die Aktion blind zu wiederholen.",
} satisfies ConnectionCopy;
