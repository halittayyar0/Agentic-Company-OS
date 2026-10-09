import type { InferenceAccountingCopy } from "../inference-accounting-copy";
export default {
  title: "Modellnutzungsprotokolle",
  clear: "Keine ungeklärte Nutzung",
  pending: "Antwortzeit noch offen",
  recovery_required: "Nutzung muss geprüft werden",
  pendingHelp:
    "Eine Antwort kann noch eintreffen. Dieser Status bestätigt nicht, dass der Agent läuft.",
  recoveryHelp:
    "Die Nutzung konnte nicht bestätigt werden. Weitere Modellanfragen in diesem Bereich bleiben pausiert. Bewahren Sie die Anfrage-ID zur Prüfung auf. Eine Statusprüfung sendet die Anfrage nicht erneut.",
  clearHelp:
    "Kein ungeklärter Nutzungsdatensatz blockiert diesen Bereich. Dies bestätigt weder den Aufgabenerfolg noch eine Ausführungserlaubnis.",
  inspect: "Gespeicherte Protokolle prüfen",
  error:
    "Der aktuelle Status kann nicht bestätigt werden. Bereits angezeigte Protokolle bleiben erhalten.",
  observed: "Zuletzt geprüft",
  request: "Anfrage-ID",
  tokens: "Token",
  lowerBound: "Gemeldete Mindestnutzung",
  complete: "Gemeldete Nutzung",
  unknownUsage: "Nutzung unbekannt",
  unknownCost: "Kosten nicht gemeldet",
  more: "Die letzten 20 Einträge werden angezeigt; ungeklärte Einträge stehen zuerst.",
  states: {
    reserved: "Vorbereitet; nicht gesendet",
    dispatched: "Gesendet; Nutzungsnachweis ausstehend",
    uncertain: "Nutzung unbestätigt",
    accounted: "Nutzung erfasst",
    not_dispatched: "Nicht gesendet",
  },
} satisfies InferenceAccountingCopy;
