import type { CompanyRoomCopy } from "../company-room-copy";
export default {
  title: "Unternehmensraum",
  eyebrow: "Gemeinsames Gedächtnis",
  description:
    "Ein dauerhafter Gesprächsraum für dein Team. Verwalte Mitglieder, erwähne Fachkräfte und halte Entscheidungen fest.",
  members: "Raummitglieder",
  memberRegion: "Mitglieder des Unternehmensraums",
  activeMembers: "Aktive Mitglieder",
  rosterHelp:
    "Mitgliedschaft und Antwortbudget sind getrennt. Fachkräfte können beschäftigt sein oder ohne Beitrag schweigen.",
  openChat: "Fachchat öffnen",
  join: "Zum Raum hinzufügen",
  leave: "Aus dem Raum entfernen",
  inactive: "Inaktiv",
  memberAdded: "Mitglied hinzugefügt",
  memberRemoved: "Mitglied entfernt",
  memberError:
    "Die Mitgliedschaft konnte nicht bestätigt werden. Aktualisiere die Liste vor einem neuen Versuch.",
  rosterError: "Die Mitgliederliste konnte nicht geladen werden.",
  rosterStale:
    "Die Liste konnte nicht aktualisiert werden. Senden und Änderungen sind pausiert.",
  noAgents: "Keine Fachkräfte verfügbar",
  noMembers: "Noch keine Mitglieder",
  loadingMembers: "Mitglieder werden geladen",
  loadingMessages: "Nachrichten werden geladen",
  messagesError: "Der Raum konnte nicht geladen werden.",
  messagesStale:
    "Das zuletzt geladene Gespräch wird angezeigt. Vor dem Senden aktualisieren.",
  empty: "Im Raum ist es noch still",
  emptyHelp:
    "Schreibe eine Nachricht oder erwähne ein Mitglied mit @. Nachrichten behalten ihre gespeicherte Absenderidentität.",
  firstMessage: "Erste Nachricht schreiben",
  retry: "Aktualisieren",
  older: "Ältere Nachrichten laden",
  newMessages: "Zu den neuesten Nachrichten",
  loadedMessages: "Geladene Nachrichten",
  founder: "Betreiber",
  agent: "Fachkraft",
  roomReply: "Raumantwort",
  projectNote: "Projektnotiz",
  operatorMessage: "Betreibernachricht",
  project: "Projekt",
  source:
    "Nachrichten und eigene Identitäten bleiben in ihrer Originalsprache.",
  skipped: "Antwortstatus",
  busy: "mit anderer Arbeit beschäftigt",
  unavailable: "nicht verfügbar",
  empty_response: "keine Antwort erstellt",
  model_error: "Antwort konnte nicht erstellt werden",
  not_relevant: "hatte keinen Beitrag",
  not_mentioned: "wurde nicht erwähnt",
  budget_guard: "wegen Antwortbudget übersprungen",
  close: "Schließen",
  compose: "Nachricht an den Unternehmensraum",
  placeholder: "Nachricht schreiben; mit @ ein Mitglied erwähnen",
  send: "An Unternehmensraum senden",
  sending: "Nachricht wird gespeichert, Antworten werden erwartet…",
  mentionMembers: "Erwähnbare Raummitglieder",
  removeMention: "Erwähnung entfernen",
  noMatches: "Kein passendes aktives Mitglied",
  mentionedHelp:
    "Nur erwähnte aktive Mitglieder werden für Antworten berücksichtigt.",
  ambientHelp:
    "Ohne Erwähnungen prüfen Mitglieder die Nachricht; nur relevante Beiträge werden beantwortet.",
  invalidMention:
    "Ein erwähntes Mitglied hat den Raum verlassen oder seine Identität geändert. Prüfe den Entwurf.",
  stored: "Nachricht gespeichert",
  storedHelp:
    "Die begrenzte Antwortrunde ist beendet. Übersprungene Mitglieder haben nicht geantwortet.",
  unconfirmed:
    "Deine Nachricht wurde gespeichert, aber nicht alle Antworten sind bestätigt. Prüfe das Gespräch; die Wiederherstellung startet keine neue Runde.",
  unknown:
    "Das Sendeergebnis ist unklar. Stelle diesen Versand wieder her, bevor du eine weitere Nachricht schreibst.",
  recover: "Versand wiederherstellen",
  storageError:
    "Der Browser konnte die Wiederherstellungsdaten nicht speichern. Schaffe Sitzungsspeicher und versuche es erneut.",
  conflict:
    "Diese Versandkennung gehört zu anderem Inhalt. Bewahre den Entwurf auf und prüfe den Raum vor einem neuen Versand.",
  invalid: "Anfrage abgelehnt. Prüfe Nachricht und Mitglieder.",
  capacity: "Das Nachrichtenlimit wurde erreicht.",
  stopped:
    "Notstopp aktiv. Neue Nachrichten sind pausiert; bestehende Sendungen können wiederhergestellt werden.",
  safetyUnknown:
    "Der Sicherheitsstatus ist unbekannt. Neue Nachrichten sind pausiert.",
  pendingHelp:
    "Ein Versand wartet auf Wiederherstellung. Text, Empfänger und Sprache bleiben unverändert.",
  newSend: "Weitere Nachricht schreiben",
} satisfies CompanyRoomCopy;
