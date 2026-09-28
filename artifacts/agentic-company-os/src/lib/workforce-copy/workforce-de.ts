import type { WorkforceCopy } from "../workforce-copy";

export default {
  storageError:
    "Die Anfrage konnte in diesem Tab nicht gespeichert werden. Die Einrichtung wurde nicht gestartet. Prüfe die Website-Speichereinstellungen.",
  eyebrow: "Vorbereitete Teams",
  title: "Teamstudio",
  description:
    "Wähle ein Team, prüfe Rollen und Übergaben und richte es unter einer vorhandenen Leitung ein.",
  library: "Teamvorlagen",
  roles: "Rollen",
  crew: "Flexibles Team",
  flow: "Geordneter Ablauf",
  recommended: "Geeignet für",
  triggers: "Startthemen",
  structure: "Teamstruktur",
  handoffs: "Aufgabenübergaben",
  noHandoffs: "Für dieses Team sind keine Übergaben definiert.",
  manager: "Leitung",
  expert: "Fachkraft",
  reportsTo: "Berichtet an",
  selectedManager: "Gewählte Leitung",
  ai: "KI-Zuweisung",
  next: "Nächster Schritt",
  review: "Prüfung",
  configure: "Team konfigurieren",
  setup: "Team einrichten",
  managerHelp:
    "Angezeigt werden aktive Leitungen, die Fachkräfte anlegen dürfen.",
  noManagers: "Keine berechtigte Leitung verfügbar.",
  outcome: "Erstes Ergebnis (optional)",
  outcomePlaceholder: "Beschreibe, welches Ergebnis das Team liefern soll.",
  outcomeHelp: "Leer lassen, um das Team ohne Arbeitsauftrag einzurichten.",
  outcomeInvalid: "Mindestens 3 Zeichen eingeben oder leer lassen.",
  finite: "Ein Ergebnis",
  continuous: "Fortlaufend",
  cadence: "Wiederholung",
  hour: "Stündlich",
  fourHours: "Alle 4 Stunden",
  day: "Täglich",
  week: "Wöchentlich",
  scope:
    "Berechtigungen bleiben auf die Rechte der gewählten Leitung begrenzt.",
  approval:
    "Genehmigungspflichtige Aktionen benötigen weiterhin eine Freigabe.",
  atomic: "Teammitglieder und optionaler Auftrag werden gemeinsam gespeichert.",
  install: "Team einrichten",
  installStart: "Einrichten und starten",
  installing: "Wird eingerichtet…",
  installed: "Team eingerichtet",
  receipt: "Einrichtungsbeleg",
  openTask: "Laufenden Auftrag öffnen",
  another: "Weiteres Team erstellen",
  retry: "Erneut versuchen",
  loading: "Teamstudio wird geladen",
  loadError: "Team- oder Leitungsdaten konnten nicht geladen werden.",
  empty: "Keine Teamvorlagen verfügbar.",
  stale:
    "Einige Daten konnten nicht aktualisiert werden. Prüfe vor dem Einrichten den aktuellen Katalog.",
  safetyUnknown: "Sicherheitsstatus nicht bestätigt. Einrichtung pausiert.",
  stopped: "Notstopp aktiv. Neue Teams können nicht eingerichtet werden.",
  unknown:
    "Das Ergebnis der Einrichtung ist unbekannt. Die Anfrage ist in diesem Browser-Tab gespeichert. Stelle das Ergebnis wieder her, bevor du ein weiteres Team erstellst.",
  recover: "Einrichtung wiederherstellen",
  rejected:
    "Der Server hat die Einrichtung abgelehnt. Prüfe die Angaben und versuche es erneut.",
  versionChanged:
    "Die Vorlage wurde geändert. Aktualisiere sie und prüfe die neue Version.",
  managerChanged:
    "Die Leitung ist nicht mehr berechtigt. Aktualisiere die Liste und wähle eine andere.",
  capacity: "Die Grenze für Fachkräfte oder Aufträge ist erreicht.",
} satisfies WorkforceCopy;
