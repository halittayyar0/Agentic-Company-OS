import type { ApprovalCopy } from "../approval-copy";
export default {
  emptyPage: "Keine Anfragen auf dieser Seite",
  closedPreview:
    "Bei abgeschlossenen Berechtigungen wird die Befehlsvorschau ausgeblendet.",
  eyebrow: "Menschliche Kontrolle",
  title: "Freigaben",
  description:
    "Prüfe, welche Aktionen die Agenten ausführen möchten. Kontrolliere vor der Entscheidung den genauen Umfang.",
  pending: "Ausstehend",
  approved: "Genehmigt",
  rejected: "Abgelehnt",
  spend: "Ausgaben",
  delete: "Löschen",
  publish: "Veröffentlichen",
  external_contact: "Externer Kontakt",
  other: "Sonstiges",
  shown: "Angezeigte Anfragen",
  newer: "Neuere Anfragen",
  older: "Ältere Anfragen",
  retry: "Anfragen aktualisieren",
  loading: "Freigabeanfragen werden geladen",
  loadError: "Freigabeanfragen konnten nicht geladen werden.",
  stale:
    "Anfragen konnten nicht aktualisiert werden. Entscheidungen sind bis zur Prüfung des aktuellen Stands pausiert.",
  emptyPending: "Keine ausstehenden Anfragen",
  emptyPendingHelp: "Neue Anfragen für deine Entscheidung erscheinen hier.",
  emptyApproved: "Keine genehmigten Anfragen",
  emptyApprovedHelp:
    "Genehmigte Anfragen werden hier aufgelistet. Eine Freigabe bestätigt keine Ausführung.",
  emptyRejected: "Keine abgelehnten Anfragen",
  emptyRejectedHelp: "Abgelehnte und abgelaufene Anfragen erscheinen hier.",
  requester: "Angefragt von",
  unknownRequester: "Fachkraft",
  task: "Auftrag öffnen",
  note: "Entscheidungsnotiz",
  notePlaceholder: "Optionale Notiz, höchstens 2.000 Zeichen",
  approve: "Genehmigen",
  reject: "Ablehnen",
  saving: "Entscheidung wird gespeichert…",
  approvedSaved: "Freigabe gespeichert",
  rejectedSaved: "Ablehnung gespeichert",
  approvedHelp:
    "Die Ausführung ist noch nicht bestätigt. Verfolge das Ergebnis im verknüpften Auftrag.",
  rejectedHelp: "Der Auftrag ist bis zur nächsten Anweisung blockiert.",
  safetyStopped:
    "Notstopp aktiv. Anfragen können abgelehnt werden; Freigaben sind pausiert.",
  safetyUnknown:
    "Sicherheitsstatus nicht bestätigt. Anfragen können abgelehnt werden; Freigaben sind pausiert.",
  scope: "Einmalige Berechtigung für genau diese Aktion",
  tool: "Werkzeug",
  target: "Ziel",
  hash: "Befehlsprüfsumme",
  preview: "Genaue Vorschau",
  expires: "Gültig bis",
  consumed: "Berechtigung verwendet",
  consumedHelp: "Die Verwendung bestätigt keinen Erfolg. Prüfe den Auftrag.",
  expired: "Abgelaufen",
  noExpiry: "Kein Ablauf angegeben",
  unscoped:
    "Diese Anfrage dokumentiert deine Entscheidung. Sie gewährt keine wiederverwendbare Werkzeugberechtigung.",
  source: "Der Anfragetext stammt vom Agenten.",
  missingScope:
    "Umfang, Vorschau oder Ablauf fehlt oder ist ungültig. Fordere eine neue Freigabeanfrage an.",
  hostTitle: "Shell-Befehl auf dem Host",
  hostCategory: "Hostzugriff",
  hostWarning:
    "Dieser Befehl läuft außerhalb der Agenten-Sandbox unter dem Betriebssystemkonto des API-Dienstes.",
  hostDetails:
    "Er erhöht keine Windows-UAC- oder Unix-Rechte. Er kann Dateien, Programme und Prozesse beeinflussen, auf die dieses Konto zugreifen kann. Prüfe den vom Server gelieferten Befehl und das Ziel.",
  hostConfirm: "Hostbefehl bestätigen",
  confirmInstruction:
    "Gib die ersten 8 Zeichen der unten angezeigten Prüfsumme ein.",
  confirmInput: "Erste 8 Zeichen der Prüfsumme",
  confirmSubmit: "Hostbefehl genehmigen",
  cancel: "Abbrechen",
  unknownError:
    "Das Entscheidungsergebnis konnte nicht bestätigt werden. Aktualisiere die Anfragen vor einer neuen Entscheidung.",
  changedError:
    "Diese Anfrage wurde geändert oder bereits entschieden. Aktualisiere sie vor einer Entscheidung.",
  expiredError:
    "Die Berechtigung ist abgelaufen. Bitte den Agenten um eine neue Anfrage.",
  confirmationError:
    "Die Prüfsumme stimmt nicht überein. Prüfe die aktuelle Anfrage.",
  inputError:
    "Die Entscheidung wurde nicht angenommen. Prüfe die Notiz und aktualisiere die Anfrage.",
} satisfies ApprovalCopy;
