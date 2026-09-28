import type { EmergencyControlCopy } from "../emergency-control-copy";

export default {
  checking: "Not-Aus-Status wird geprüft",
  retryLabel: "Not-Aus-Status erneut prüfen",
  unavailable: "Not-Aus-Status konnte nicht geladen werden",
  stop: "Not-Aus",
  resume: "Fortsetzen",
  resumeLabel: "Arbeit fortsetzen",
  stopTitle: "Alle Agentenarbeiten stoppen",
  resumeTitle: "Agentenarbeiten fortsetzen",
  stopDescription:
    "Diese Sicherheitsbremse hält Agentenchats, Aufgaben, Werkzeuge und genehmigte Aktionen an. Bereits erfolgte externe Auswirkungen werden nicht rückgängig gemacht.",
  resumeDescription:
    "Aufgabenplanung, Agentenchats, Werkzeuge und genehmigte Aktionen können wieder laufen. Prüfe vorher, ob der Arbeitsbereich sicher ist.",
  reason: "Grund für den Stopp",
  reasonPlaceholder: "Zum Beispiel: Unerwartete Browseraktion wird geprüft",
  reasonHelp: "Mindestens 3 Zeichen; wird im Prüfprotokoll gespeichert.",
  actionError:
    "Die Aktion konnte nicht abgeschlossen werden. Erneut versuchen.",
  cancel: "Abbrechen",
  applying: "Wird angewendet…",
  confirmResume: "Ja, Arbeit fortsetzen",
  confirmStop: "Ja, alle Arbeiten stoppen",
  safetyUnknown:
    "Der Status der Sicherheitsbremse kann nicht geprüft werden; neue riskante Aktionen sind gesperrt.",
  retry: "Erneut prüfen",
  stopActive: "Not-Aus ist aktiv.",
} satisfies EmergencyControlCopy;
