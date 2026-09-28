import type { WorkforceCatalogCopy } from "../workforce-localization";

export default {
  "product-shipping-crew": {
    name: "Produktlieferteam",
    tagline: "Problem prüfen, Produkt liefern, Ergebnis belegen.",
    description:
      "Ein fachübergreifendes Team unter einer verantwortlichen Leitung, das Produktentscheidungen von der Erkundung bis zur Lieferung durch Forschung, Umsetzung und Qualitätsnachweise absichert.",
    recommendedFor: [
      "Neue Funktion oder Produktlinie",
      "Unklares Kundenproblem",
      "Lieferung mit Forschung, Entwicklung und Qualitätssicherung",
    ],
    triggerLabels: ["Produkt", "Funktion", "MVP", "Einführung", "Lieferung"],
    members: {
      "product-lead": {
        name: "Produktkoordinator",
        role: "Leitung Produktlieferung",
        mission:
          "Übersetze Geschäftsziel und Nutzerproblem in messbare Abnahmekriterien; koordiniere Erkundung, Entwicklung und Qualität in einem Lieferplan.",
        capabilities: [
          "Problemdefinition",
          "Lieferplanung",
          "Abhängigkeitsmanagement",
          "Ergebnisprüfung",
        ],
      },
      "discovery-researcher": {
        name: "Nutzerforscher",
        role: "Forscher für Produktfindung",
        mission:
          "Prüfe die Arbeit der Zielnutzer, vorhandene Alternativen und kritische Annahmen anhand aktueller Quellen und nachvollziehbarer Belege.",
        capabilities: [
          "Nutzerforschung",
          "Wettbewerbsrecherche",
          "Belegmatrix",
        ],
      },
      "delivery-engineer": {
        name: "Umsetzungsentwickler",
        role: "Entwickler für Produktlieferung",
        mission:
          "Setze den freigegebenen Umfang als kleinste sichere, testbare Produktionsänderung um, die zur bestehenden Architektur passt.",
        capabilities: [
          "Technischer Entwurf",
          "Umsetzung",
          "Testautomatisierung",
          "Freigabevorbereitung",
        ],
      },
      "quality-reviewer": {
        name: "Qualitätsprüfer",
        role: "Prüfer für Produktqualität",
        mission:
          "Prüfe Anforderungen, Barrierefreiheit, Fehlerverhalten und Belegqualität unabhängig; formuliere konkrete Korrekturaufträge für festgestellte Lücken.",
        capabilities: [
          "Abnahmetests",
          "Prüfung von Sonderfällen",
          "Belegprüfung",
        ],
      },
    },
    handoffs: {
      "discovery-researcher/product-lead/review":
        "Lege Problembelege, Unsicherheiten und den vorgeschlagenen Umfang der Leitung zur Entscheidung vor.",
      "product-lead/delivery-engineer/ai":
        "Übergib den freigegebenen Umfang, Abnahmekriterien und erwartete Belege als Umsetzungsauftrag.",
      "delivery-engineer/quality-reviewer/next":
        "Übergib Umsetzungsergebnisse und durchgeführte Prüfungen zur unabhängigen Qualitätskontrolle.",
      "quality-reviewer/product-lead/review":
        "Berichte bestandene Prüfungen, offene Lücken und die Freigabeempfehlung als Entscheidungsgrundlage.",
    },
  },
  "go-to-market-crew": {
    name: "Markteinführungsteam",
    tagline: "Passende Zielkunden, belegbare Botschaften, messbare Nachfrage.",
    description:
      "Ein Wachstumsteam, das Zielkundenforschung mit Positionierung, Inhalten und Vertriebsaktivierung verbindet. Entwürfe werden nicht als echte Kontakte oder Umsatz gewertet.",
    recommendedFor: [
      "Produkt- oder Markteinführung",
      "Nachfragegewinnung im B2B-Bereich",
      "Prüfung von Botschaften und Kanälen",
    ],
    triggerLabels: [
      "Wachstum",
      "Vertrieb",
      "Kampagne",
      "GTM",
      "Vertriebspipeline",
    ],
    members: {
      "gtm-lead": {
        name: "GTM-Koordinator",
        role: "Leitung Markteinführung",
        mission:
          "Verbinde Zielkundenprofil, Angebot, Kanäle und Vertriebsansatz in einem Messplan; verknüpfe Teamergebnisse mit qualifizierter Nachfrage.",
        capabilities: [
          "Markteinführungsstrategie",
          "Botschaftenhierarchie",
          "Kanalportfolio",
          "Experimentmanagement",
        ],
      },
      "market-analyst": {
        name: "Marktanalyst",
        role: "Analyst für Marktinformationen",
        mission:
          "Erfasse passende Zielkunden, Kaufauslöser, Alternativen und Differenzierungsbelege anhand von Primärquellen.",
        capabilities: [
          "Zielkundenforschung",
          "Kundensignale",
          "Wettbewerbsbelege",
        ],
      },
      "campaign-builder": {
        name: "Kampagnengestalter",
        role: "Kampagnen- und Inhaltsgestalter",
        mission:
          "Übersetze überprüfte Botschaften in belegte, messbare Kampagnenergebnisse für den jeweiligen Kanal; erhalte die Verbindung zwischen Aussagen und Nachweisen.",
        capabilities: [
          "Kampagnenaufträge",
          "Inhaltserstellung",
          "Kanalanpassung",
        ],
      },
      "revenue-operator": {
        name: "Vertriebskoordinator",
        role: "Spezialist für Vertriebsaktivierung",
        mission:
          "Qualifiziere priorisierte Zielkunden, erstelle persönliche Kontaktentwürfe und dokumentiere jeden Fortschritt als belegte Vertriebsphase.",
        capabilities: [
          "Kundenpriorisierung",
          "Kontaktentwürfe",
          "Chancenqualifizierung",
          "Pipeline-Nachweise",
        ],
      },
    },
    handoffs: {
      "market-analyst/gtm-lead/review":
        "Lege Zielkunden- und Differenzierungsbelege der Leitung zur Prüfung der Botschaft vor.",
      "gtm-lead/campaign-builder/ai":
        "Übergib das freigegebene Segment, Angebot, Aussagegrenzen und Kanalmessungen als Produktionsauftrag.",
      "campaign-builder/revenue-operator/next":
        "Übergib freigegebene Botschaften und Nachweise zur gezielten Vertriebsaktivierung; Versandaktionen bleiben unter Nutzerkontrolle.",
      "revenue-operator/gtm-lead/review":
        "Berichte tatsächliche Kontakte und Pipeline-Nachweise getrennt von Entwurfs- und Aktivitätskennzahlen.",
    },
  },
  "incident-command-flow": {
    name: "Ablauf zur Störungsbehebung",
    tagline:
      "Auswirkungen begrenzen, Ursache belegen, sicher wiederherstellen.",
    description:
      "Ein kontrollierter Ablauf, der betriebliche oder technische Störungen nacheinander durch Einstufung, Untersuchung, Wiederherstellungsprüfung und Kommunikation führt.",
    recommendedFor: [
      "Produktionsstörung oder Dienstausfall",
      "Verdacht auf ein Sicherheitsproblem",
      "Wiederkehrender Betriebsfehler",
    ],
    triggerLabels: ["Störung", "Ausfall", "Fehler", "Sicherheit", "SLA"],
    members: {
      "incident-lead": {
        name: "Einsatzleiter",
        role: "Leitung Störungsbehebung",
        mission:
          "Führe einen zentralen Vorfallsbericht von den Auswirkungen bis zur Wiederherstellung; priorisiere Kundenauswirkungen, Sicherheit und Umkehrbarkeit.",
        capabilities: [
          "Einstufung",
          "Vorfallszeitlinie",
          "Entscheidungen und Verantwortung",
          "Wiederherstellungsfreigabe",
        ],
      },
      "systems-investigator": {
        name: "Systemanalyst",
        role: "Untersuchung technischer Systeme",
        mission:
          "Mache Symptome durch reproduzierbare Belege nachvollziehbar; grenze Ursachenhypothesen durch Prüfungen von Protokollen, Änderungen und Abhängigkeiten ein.",
        capabilities: [
          "Technische Einstufung",
          "Protokollanalyse",
          "Ursachenhypothesen",
        ],
      },
      "risk-reviewer": {
        name: "Risikoprüfer",
        role: "Prüfer für Sicherheit und Wiederherstellung",
        mission:
          "Prüfe die vorgeschlagene Korrektur unabhängig auf Sicherheit, Datenintegrität, Rücknahme und Wiederholungsrisiko.",
        capabilities: [
          "Risikobewertung",
          "Rücknahmeprüfung",
          "Wiederherstellungsprüfung",
        ],
      },
      "stakeholder-reporter": {
        name: "Kommunikationsbeauftragter",
        role: "Spezialist für Vorfallskommunikation",
        mission:
          "Erstelle aus bestätigten Vorfallsdaten einen klaren Kommunikationsentwurf mit Auswirkungen, aktuellem Stand, nächster Aktualisierung und nötigen Nutzeraktionen.",
        capabilities: [
          "Statusübersichten",
          "Entwürfe für Kundenkommunikation",
          "Nachbetrachtung",
        ],
      },
    },
    handoffs: {
      "incident-lead/systems-investigator/next":
        "Übergib den eingegrenzten Vorfallskontext, die Zeitlinie und sichere Untersuchungsgrenzen.",
      "systems-investigator/risk-reviewer/review":
        "Lege Ursachenbelege, die vorgeschlagene Korrektur und den Rücknahmeplan zur unabhängigen Prüfung vor.",
      "risk-reviewer/incident-lead/review":
        "Melde die Wiederherstellungsempfehlung mit bestandenen Prüfungen, offenen Risiken und Rücknahmebedingungen an die Leitung.",
      "incident-lead/stakeholder-reporter/ai":
        "Fordere einen Kommunikationsentwurf an, der ausschließlich die bestätigte Zeitlinie und den freigegebenen Vorfallsstatus verwendet.",
    },
  },
} satisfies WorkforceCatalogCopy;
