import type { CompletionRequirementsCopy } from "../completion-requirements-copy";
const copy = {
  unavailableActive:
    "Die Koordination kann diesen Vorgang nicht mehr ausführen. Prüfe die bestehenden Berechtigungen in den Einstellungen. Die gespeicherte Bedingung bleibt verbindlich.",
  title: "Abschlussbedingungen",
  optional: "Optional",
  help: "Wähle Vorgänge, die erfolgreich ausgeführt werden müssen, bevor das Projekt abgeschlossen wird. Wiederkehrende Arbeit benötigt in jedem Durchlauf einen neuen Erfolgsnachweis.",
  limit: "Wähle höchstens acht Vorgänge.",
  loading: "Erlaubte Vorgänge werden geprüft…",
  loadError:
    "Die Vorgänge konnten nicht geprüft werden. Deine Auswahl bleibt erhalten.",
  retry: "Erneut prüfen",
  empty: "Derzeit sind keine geeigneten Vorgänge verfügbar.",
  search: "Vorgang suchen",
  selected: "Ausgewählt",
  remove: "Bedingung entfernen",
  unavailable:
    "Die Koordination kann diesen Vorgang derzeit nicht ausführen. Entferne die Bedingung vor dem Start oder prüfe die bestehenden Berechtigungen in den Einstellungen.",
  satisfied: "Erfolg erfasst",
  missing: "Kein Erfolg erfasst",
  cycle: "Durchlauf",
  observed: "Geprüft",
  sourceHelp:
    "Dies sind gespeicherte Ausführungsnachweise für diesen Durchlauf. Ein erfolgreicher Vorgang bestätigt nicht die Richtigkeit der endgültigen Antwort; die normale Prüfung bleibt erforderlich.",
  permissionHelp:
    "Eine Bedingung erteilt keine Berechtigung, aktiviert keine Werkzeuge und startet keine Arbeit.",
  other: "Installierter Vorgang",
  labels: {
    calculate: "Zahlen berechnen",
    analyze_text: "Text analysieren",
    compare_text: "Texte vergleichen",
    inspect_json: "JSON prüfen",
    profile_csv: "CSV-Daten analysieren",
    convert_datetime: "Datum und Uhrzeit umrechnen",
    inspect_url: "URL prüfen",
    hash_text: "Textprüfsumme erstellen",
    vm_run_command: "Befehl ausführen",
    vm_run_sudo_command: "Befehl mit erhöhten Rechten ausführen",
    vm_list_files: "Dateien auflisten",
    vm_read_file: "Datei lesen",
    vm_write_file: "Datei schreiben",
    computer_observe: "Computer beobachten",
    browser_open: "Webseite öffnen",
    browser_snapshot: "Webseite prüfen",
    browser_click: "Auf Webseite klicken",
    browser_type: "Auf Webseite schreiben",
    browser_scroll: "Webseite scrollen",
    browser_extract_text: "Seitentext extrahieren",
    browser_wait: "Auf Webseite warten",
    browser_save_screenshot: "Seitenbild speichern",
    run_extension: "Installierte Erweiterung ausführen",
  },
} satisfies CompletionRequirementsCopy;
export default copy;
