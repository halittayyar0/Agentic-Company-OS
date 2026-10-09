import type { NewProjectCopy } from "../new-project-copy";

const copy = {
  recovery: {
    title: "Projektstart wiederfinden",
    uncertain:
      "Die Antwort wurde nicht bestätigt. Prüfe diese gespeicherte Anfrage, bevor du ein weiteres Projekt startest.",
    missing:
      "Es wurde noch kein Ergebnis gefunden. Die erste Anfrage kann noch ankommen; ein erneuter Versuch verwendet dieselbe Anfrage.",
    created:
      "Dein Projektbereich wurde erstellt. Öffne ihn, um den aktuellen Arbeitsstand zu sehen.",
    rejected:
      "Diese Anfrage wurde abgelehnt. Behebe die Ursache und bereite einen neuen Start vor; dein Entwurf bleibt erhalten.",
    checking: "Anfrage wird geprüft…",
    check: "Anfrage prüfen",
    open: "Projekt öffnen",
    retry: "Dieselbe Anfrage wiederholen",
    prepare: "Neuen Start vorbereiten",
    stored: "Gesendetes Projekt",
    storageError:
      "Dieser Tab konnte die gespeicherte Anfrage nicht verifizieren. Sichere deinen Entwurf. Eine neue Anfrage wird erst nach erfolgreichem Speichern gesendet; ein beschädigter Eintrag muss in diesem Tab wiederhergestellt werden.",
    noTokens:
      "Die Prüfung liest nur das gespeicherte Ergebnis. Sie verbraucht keine Modell-Tokens und führt die Arbeit nicht erneut aus.",
    reasons: {
      EMERGENCY_STOP_ACTIVE: "Der Notstopp ist aktiv.",
      AGENT_UNAVAILABLE: "Das benötigte aktive Team war nicht verfügbar.",
      RUNTIME_CAPACITY_EXCEEDED:
        "Das Limit für gleichzeitig laufende Arbeiten wurde erreicht.",
      EXECUTION_POLICY_DENIED:
        "Die Ausführungsrichtlinie hat diesen Start blockiert.",
    },
  },
  draftStorageError:
    "Dieser Tab kann den Entwurf beim Neuladen nicht wiederherstellen. Sie können den Text hier weiter bearbeiten; kopieren Sie ihn vor dem Neuladen oder Schließen des Tabs.",
  back: "Zurück zu Projekten",
  eyebrow: "Neues Projekt · gesamtes Team",
  title: "Bring deine Idee ein. Setze sie mit deinem Team um.",
  teamDescription: (count) =>
    `Du musst keine einzelne verantwortliche Person auswählen. Das ganze aktive Team${count ? ` (Größe: ${count})` : ""} teilt denselben Projektkontext und wird bei Bedarf tätig.`,
  teamUnavailable:
    "Das aktive Team konnte nicht geladen werden. Der Projektstart ist angehalten.",
  retry: "Erneut versuchen",
  projectName: "Projektname",
  namePlaceholder: "Zum Beispiel: Plattform für Kundeneinblicke",
  brief: "Ziel und Umfang",
  briefPlaceholder:
    "Was möchtest du erreichen? Beschreibe Erfolgskriterien, vorhandenen Kontext und das gewünschte Ergebnis…",
  projectType: "Projektart",
  finite: "Ergebnisorientiert",
  continuous: "Fortlaufend",
  priority: "Projektpriorität",
  priorities: {
    low: "Niedrig",
    normal: "Normal",
    high: "Hoch",
    urgent: "Dringend",
  },
  starting: "Team wird hinzugefügt…",
  start: "Projekt starten",
  cadence: "Arbeitsrhythmus",
  cadences: {
    900: "Alle 15 Minuten",
    3600: "Stündlich",
    21600: "Alle 6 Stunden",
    86400: "Täglich",
    604800: "Wöchentlich",
  },
  contextNote:
    "Aktive Fachkräfte, Besprechungen und Arbeitsnachweise bleiben in diesem Projekt.",
  emergencyStop:
    "Der Notstopp ist aktiv. Du kannst kein neues Projekt starten. Dein Entwurf bleibt auf dieser Seite erhalten.",
  safetyUnverified:
    "Ein neues Projekt kann erst gestartet werden, wenn der Sicherheitsstatus bestätigt ist.",
  teamLoading: "Team wird geladen",
  teamAria: (count) => `Projektteam mit ${count} aktiven Fachkräften`,
  validationTitle: "Dem Projekt fehlt eine Richtung",
  validationDescription:
    "Gib einen Projektnamen und das gewünschte Ergebnis ein.",
  noTeamTitle: "Kein aktives Team gefunden",
  noTeamDescription:
    "Aktiviere mindestens eine Fachkraft, bevor du das Projekt startest.",
  successTitle: "Projektarbeitsbereich erstellt",
  successDescription: (id) =>
    `Projekt #${id} erstellt. Aktive Fachkräfte wurden hinzugefügt.`,
  failureTitle: "Projekt konnte nicht gestartet werden",
  failureDescription:
    "Prüfe Verbindung und Berechtigungen und versuche es erneut. Dein Entwurf bleibt auf dieser Seite erhalten.",
} satisfies NewProjectCopy;

export default copy;
