import type { TaskResultReviewCopy } from "../task-result-review-copy";
export default {
  title: "Ergebnisvorschlag prüfen",
  help: "Die automatische Prüfung hat diesen Vorschlag abgelehnt. Prüfen Sie das genaue Ergebnis. Ihre Bestätigung beendet diese Aufgabe oder diesen Zyklus, führt keine externe Aktion aus und hebt keine Pflichtaktionen auf.",
  loading: "Ergebnisvorschlag wird geladen",
  unavailable:
    "Der aktuelle Vorschlag konnte nicht geprüft werden. Vor der Entscheidung aktualisieren.",
  auth: "Für diese Prüfung muss die Anmeldung mit Zugangsschlüssel aktiviert und Ihre Sitzung angemeldet sein.",
  refresh: "Prüfung aktualisieren",
  acknowledge:
    "Ich habe genau diesen Ergebnisvorschlag geprüft und möchte ihn bestätigen.",
  confirm: "Ergebnis bestätigen",
  reject: "Ergebnis ablehnen",
  confirmed: "Ergebnis durch Bedienperson bestätigt",
  rejected: "Ergebnis abgelehnt; die Aufgabe bleibt blockiert.",
  error:
    "Der Ausgang ist unbestätigt. Prüfung und Anfragen vor einer weiteren Entscheidung aktualisieren.",
  safety:
    "Bestätigung pausiert, bis der Sicherheitsstatus verfügbar und der Notstopp aufgehoben ist.",
  digest: "Prüfsumme des Vorschlags",
  cycle: "Zyklus",
  expires: "Gültig bis",
  requirements: "Pflichtaktionen",
  satisfied: "Verifizierter Erfolgsbeleg",
  source_mismatch:
    "Das vorgeschlagene Ergebnis widerspricht der gelesenen Quelle.",
  missing_required_action:
    "Die Prüfung konnte eine ausdrücklich geforderte Aktion nicht bestätigen.",
  unauthorized_action:
    "Die Prüfung meldete eine Aktion außerhalb des erlaubten Umfangs.",
  insufficient_evidence:
    "Die Prüfung fand unzureichende Belege für den Abschluss.",
  provenance: "Durch Bedienperson bestätigt",
  provenanceHelp:
    "Dieses Ergebnis wurde von einer Bedienperson bestätigt. Die automatische Prüfung hat es nicht akzeptiert.",
} satisfies TaskResultReviewCopy;
