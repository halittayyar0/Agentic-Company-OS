import type { CatalogLocale } from "../catalog-types";
export const de: CatalogLocale = {
  copy: {
    title: "Fähigkeiten & Werkzeuge",
    intro:
      "Beginnen Sie mit einem klaren Ablauf. Prüfen Sie die Eingaben und passen Sie die Fähigkeit an Ihr Projekt an.",
    search: "Fähigkeiten suchen",
    all: "Alle Bereiche",
    empty: "Keine Fähigkeit entspricht dieser Suche.",
    skills: "Arbeitsabläufe",
    tools: "Integrierte Werkzeuge",
    inputs: "Benötigte Angaben",
    steps: "Vorgehen",
    checks: "Vor der Übergabe",
    deliverable: "Erwartetes Ergebnis",
    use: "Projektentwurf erstellen",
    requirements: "Werkzeuge und Zugriff",
    browser: "Browserzugriff",
    files: "Dateizugriff im Arbeitsbereich",
    boundary:
      "Fähigkeiten sind Arbeitsanleitungen, keine Berechtigungen oder Erfolgsgarantien. Fragen Sie nach fehlenden Angaben. Beachten Sie den Auftrag und die bestehenden Freigaberegeln. Ohne Genehmigung nichts installieren, bezahlen, veröffentlichen oder an andere senden. Nennen Sie nicht verfügbare Werkzeuge und ungeprüfte Ergebnisse. Prüfen Sie diesen Entwurf vor dem Start.",
    toolBoundary:
      "Diese Werkzeuge verarbeiten bereitgestellte Daten lokal. Sie öffnen keine Dateien, greifen nicht aufs Netzwerk zu und fügen kein Abonnement hinzu. Die Modellnutzung richtet sich weiterhin nach Ihren Anbietereinstellungen.",
    error: "Die Bibliothek konnte nicht geladen werden.",
    retry: "Erneut versuchen",
    loading: "Bibliothek wird geladen…",
    invalid:
      "Die Eingabe ist ungültig oder überschreitet die Grenzen. Prüfen Sie das Werkzeugschema und die bereitgestellten Daten.",
    completed: "Werkzeugergebnis",
    skillMissing: "Diese integrierte Fähigkeit wurde nicht gefunden.",
  },
  groups: {
    research: {
      title: "Recherche",
      inputs: [
        "Frage, Zielgruppe, Entscheidung und Zeitraum.",
        "Zulässige Quellen, Ausschlüsse und verfügbarer Browserzugriff.",
      ],
      steps: [
        "Klären Sie die Frage und die Auswahlkriterien vor der Recherche.",
        "Öffnen Sie möglichst Primärquellen; erfassen Sie Adressen, Daten, Zitate und Unsicherheiten getrennt.",
        "Vergleichen Sie unabhängige Belege, markieren Sie Widersprüche und trennen Sie Beobachtung von Schlussfolgerung.",
      ],
    },
    engineering: {
      title: "Software",
      inputs: [
        "Repository oder relevante Dateien, Sollverhalten und Reproduktionsschritte.",
        "Laufzeitgrenzen, Dateizugriff und freigegebene Testbefehle.",
      ],
      steps: [
        "Prüfen Sie Implementierung und Schnittstellenverträge vor Änderungsvorschlägen.",
        "Verfolgen Sie Eingaben, Fehlerfälle und Berechtigungen; sammeln Sie eine minimale Reproduktion oder genaue Codebelege.",
        "Priorisieren Sie nach Auswirkung und nennen Sie eine begrenzte Korrektur, Prüfung und Rücknahme. Unausgeführte Tests gelten nicht als bestanden.",
      ],
    },
    data: {
      title: "Daten & Analyse",
      inputs: [
        "CSV-/JSON-/Textdaten, Felddefinitionen, Einheiten und Zeitraum.",
        "Fragestellung, Grundgesamtheit und Regeln für fehlende oder doppelte Daten.",
      ],
      steps: [
        "Prüfen Sie Struktur, Umfang und Herkunft der Daten; bewahren Sie das Original.",
        "Messen Sie Lücken, Duplikate und Typfehler vor Berechnungen; nennen Sie Ausschlüsse und Bezugsgrößen.",
        "Berechnen Sie wichtige Summen mit Werkzeugen erneut, kennzeichnen Sie Einheiten und Rundung und trennen Sie Belege von Annahmen.",
      ],
    },
    content: {
      title: "Dokumente & Inhalte",
      inputs: [
        "Quellmaterial, Zielgruppe, Sprache, Ton und Ausgabeformat.",
        "Freigegebene Fakten, Längenlimit und Veröffentlichungsbedingungen.",
      ],
      steps: [
        "Erfassen Sie freigegebene Fakten und den tatsächlichen Informationsbedarf der Zielgruppe.",
        "Erstellen Sie den Entwurf mit klaren Überschriften; erhalten Sie Namen, Zahlen und Bedeutung.",
        "Vergleichen Sie mit den Quellen, prüfen Sie Konsistenz und markieren Sie offene Fragen. Liefern Sie einen Entwurf zur Prüfung.",
      ],
    },
    operations: {
      title: "Betrieb",
      inputs: [
        "Ziel, aktueller Prozess, Verantwortliche, Fristen und Zeitzonen.",
        "Abhängigkeiten, Ressourcen, Einschränkungen und Freigabegrenzen.",
      ],
      steps: [
        "Erfassen Sie den Istzustand und klären Sie fehlende Zuständigkeiten oder wichtige Einschränkungen.",
        "Zerlegen Sie die Arbeit in beobachtbare Schritte mit Zuständigkeiten, Abhängigkeiten und Abschlusskriterien.",
        "Prüfen Sie Termine und Risiken, ergänzen Sie Eskalation und Wiederherstellung und lassen Sie externe Zusagen freigeben.",
      ],
    },
  },
  checks: [
    "Jede Tatsachenbehauptung hat eine Quelle oder ist klar als Annahme markiert; offene Lücken bleiben sichtbar.",
    "Prüfen Sie das erwartete Ergebnis anhand der Eingaben. Nennen Sie geprüfte, fehlgeschlagene und ungeprüfte Punkte.",
  ],
  skills: [
    [
      "Belegtes Kurzbriefing",
      "Liefern Sie eine kurze Antwort mit Quellentabelle, Daten, Unsicherheiten und der nächsten Entscheidung.",
    ],
    [
      "Wettbewerberübersicht",
      "Vergleichen Sie benannte Wettbewerber nach Zielgruppe, Angebot, belegbaren Funktionen und datierten Preisen; markieren Sie fehlende Belege.",
    ],
    [
      "Behauptungen prüfen",
      "Erstellen Sie je Behauptung eine Tabelle mit stützenden und widersprechenden Belegen, Quelldaten und Unsicherheitsurteil.",
    ],
    [
      "Produktvergleich",
      "Erstellen Sie einen gewichteten Anforderungsvergleich mit datierten Quellen, Ausschlusskriterien und klaren Abwägungen.",
    ],
    [
      "Literaturübersicht",
      "Ordnen Sie Facharbeiten nach Frage, Methode, Stichprobe, Befunden und Grenzen; trennen Sie Übersichten von Originalstudien.",
    ],
    [
      "Interviewplan",
      "Entwerfen Sie neutrale Fragen, ein Teilnehmerprofil, Einwilligungshinweise und eine Auswertungsvorlage; kontaktieren Sie niemanden.",
    ],
    [
      "Codeprüfung",
      "Liefern Sie priorisierte Befunde mit Dateistellen, konkreten Fehlerszenarien und gezielten Korrekturen; trennen Sie Defekte von Fragen.",
    ],
    [
      "Fehleranalyse",
      "Erstellen Sie einen reproduzierbaren Fehlerbericht mit Soll- und Istverhalten, Belegen, möglichen Ursachen und minimalem Prüfplan.",
    ],
    [
      "Testplan",
      "Ordnen Sie kritischen Verhaltensweisen Normal-, Grenz- und Fehlertests mit Testdaten und messbaren Erfolgskriterien zu.",
    ],
    [
      "API-Vertrag prüfen",
      "Vergleichen Sie Anfrage- und Antwortverträge, Authentifizierung, Fehlerbehandlung und Seitennavigation; belegen Sie inkompatible Änderungen.",
    ],
    [
      "Veröffentlichungsreife",
      "Erstellen Sie eine Prüfliste mit bestandenen, fehlgeschlagenen und offenen Prüfungen, Artefaktkennung, Rücknahmeplan und verbleibenden Hindernissen.",
    ],
    [
      "Abhängigkeiten prüfen",
      "Erfassen Sie Abhängigkeiten, Versionen, direkte und indirekte Nutzung, Lizenzbelege und Aktualisierungsrisiken; erfinden Sie keine Schwachstellen.",
    ],
    [
      "CSV-Qualitätsbericht",
      "Melden Sie Kopfzeilenprobleme, leere Zellen, ungleichmäßige Zeilen, Duplikate und Zahlenbereiche; geben Sie Korrekturregeln ohne Quelldatenänderung an.",
    ],
    [
      "JSON-Strukturprüfung",
      "Prüfen Sie JSON-Typen, Pflichtfelder und ausgewählte Pfade; zeigen Sie fehlende Pfade und Vertragsabweichungen mit begrenzten Beispielen.",
    ],
    [
      "Kennzahlenbericht",
      "Berechnen Sie klar definierte Kennzahlen mit Einheiten, Bezugsgrößen, Zeiträumen und reproduzierbaren Summen; unterscheiden Sie fehlende Werte von null.",
    ],
    [
      "Datenwörterbuch",
      "Dokumentieren Sie Bedeutung, Typ, Einheit, zulässige Werte, Herkunft und Unklarheiten jedes Feldes anhand von Quellbeispielen.",
    ],
    [
      "Datensatzabgleich",
      "Vergleichen Sie zwei Datensätze anhand eines vereinbarten Schlüssels; nennen Sie Duplikate, Lücken, Wertabweichungen und abgestimmte Summen.",
    ],
    [
      "Experimentauswertung",
      "Fassen Sie Versuchs- und Kontrollzahlen, Zielgrößen, Effektschätzungen und Grenzen zusammen; behaupten Sie ohne geeignetes Design keine Kausalität.",
    ],
    [
      "Dokumentgliederung",
      "Erstellen Sie eine zielgruppengerechte Gliederung mit Kernbotschaften, Belegen, Abschnittszielen und offenen Fragen.",
    ],
    [
      "Textüberarbeitung",
      "Liefern Sie überarbeiteten Text mit kurzer Änderungsbegründung; erhalten Sie freigegebene Fakten, Namen, Zahlenbedeutung und gewünschten Ton.",
    ],
    [
      "Übersetzungsprüfung",
      "Vergleichen Sie Original und Übersetzung nach Bedeutung, Begriffen, Zahlen, Platzhaltern und lokalen Konventionen; nennen Sie unsichere Formulierungen.",
    ],
    [
      "FAQ-Entwurf",
      "Entwerfen Sie belegte Antworten auf wahrscheinliche Nutzerfragen, markieren Sie unbelegte Antworten und nennen Sie einen Eskalationsweg.",
    ],
    [
      "Änderungsnotizen",
      "Fassen Sie gelieferte Änderungen nach Nutzerauswirkung, Umstellungsbedarf und bekannten Grenzen zusammen; behaupten Sie keine undokumentierten Korrekturen.",
    ],
    [
      "Besprechungsaufgaben",
      "Extrahieren Sie Entscheidungen, Zuständigkeiten, Fristen und offene Fragen aus Notizen; markieren Sie unzugeordnete Arbeit und unklare Termine.",
    ],
    [
      "Projektplan",
      "Erstellen Sie Meilensteine, Abhängigkeiten, Zuständigkeiten, Abnahmekriterien und einen realistischen Zeitplan mit Risiken und Annahmen.",
    ],
    [
      "Vorfallanalyse",
      "Erstellen Sie einen belegten Zeitablauf, eine Auswirkungsübersicht, beitragende Faktoren und Korrekturmaßnahmen mit Zuständigkeiten.",
    ],
    [
      "Betriebshandbuch",
      "Beschreiben Sie Voraussetzungen, nummerierte Schritte, beobachtbare Prüfungen, Fehlerzweige, Eskalation und Rücknahme.",
    ],
    [
      "Risikoregister",
      "Listen Sie konkrete Risiken mit begründeter Wahrscheinlichkeit, Auswirkung, Warnsignalen, Zuständigkeit, Maßnahmen und Restrisiko auf.",
    ],
    [
      "Prozessübersicht",
      "Erfassen Sie Auslöser, Eingaben, Schritte, Übergaben, Entscheidungen, Engpässe und messbare Ergebnisse des aktuellen Prozesses.",
    ],
    [
      "Arbeitsübergabe",
      "Bereiten Sie eine Übergabe mit aktuellem Stand, Beleglinks, Zuständigkeiten, offenen Entscheidungen, nächsten Schritten und Wiederherstellung vor.",
    ],
  ],
  tools: [
    [
      "Fähigkeiten finden",
      "Suchen Sie integrierte Fähigkeiten nach Stichwort oder Bereich.",
    ],
    [
      "Fähigkeit lesen",
      "Laden Sie Ablauf, Eingaben und Prüfungen über die genaue Kennung.",
    ],
    [
      "Berechnen",
      "Berechnen Sie Summen, Verhältnisse, Prozente und Kennwerte aus endlichen Zahlen.",
    ],
    [
      "Text analysieren",
      "Zählen Sie Wörter, Zeilen, Unicode-Zeichen und UTF-8-Bytes.",
    ],
    [
      "Text vergleichen",
      "Vergleichen Sie Zeilenpositionen mit begrenzten Auszügen und Kürzungshinweisen.",
    ],
    ["JSON prüfen", "Analysieren Sie JSON und einen genauen JSON-Pointer."],
    [
      "CSV profilieren",
      "Prüfen Sie CSV-Anführungen, Feldqualität, Zeilenstruktur und Zahlenbereiche.",
    ],
    [
      "Datum und Uhrzeit umrechnen",
      "Rechnen Sie einen Zeitstempel mit expliziter Zone in eine benannte Zeitzone um.",
    ],
    ["Adresse prüfen", "Zerlegen Sie eine URL, ohne sie zu öffnen."],
    [
      "Textfingerabdruck",
      "Berechnen Sie SHA-256 über den exakten UTF-8-Text; dies verschlüsselt ihn nicht.",
    ],
  ],
};
