<div align="center">

# Agentic Company OS

### Arbeit übergeben. Fortschritt sehen. Die Kontrolle behalten.

Ein Open-Source-Arbeitsbereich für KI-Agenten, die Werkzeuge nutzen, Aufgaben dokumentieren und sich an die von dir gewählten Berechtigungen halten.

[**Loslegen**](#schnellstart) · [**Arbeitsbereich kennenlernen**](#orientierung-im-arbeitsbereich) · [**Website**](https://halittayyar0.github.io/Agentic-Company-OS/)

[English](./README.md) · [Türkçe](./README.tr.md) · [Deutsch](./README.de.md) · [Русский](./README.ru.md) · [简体中文](./README.zh-CN.md) · [繁體中文](./README.zh-TW.md) · [العربية](./README.ar.md)

**Windows · macOS · Linux** &nbsp; / &nbsp; **7 Sprachen** &nbsp; / &nbsp; **MIT-Lizenz**

</div>

![Der tatsächliche Arbeitsbereich von Agentic Company OS mit Agenten, Projekten und Aktivitäten](./docs/assets/dashboard.png)

## Ein Arbeitsbereich, in dem Aufgaben erledigt werden

Gib einem Agenten eine klar umrissene Aufgabe oder eine Verantwortung, die sich nach Zeitplan wiederholt. Er kann die freigegebenen Werkzeuge nutzen, Ergebnisse speichern und fehlende Informationen oder deine Zustimmung anfordern. Du kannst die Arbeit verfolgen, den Ablauf prüfen und die Ausführung in derselben Oberfläche stoppen.

Jede Installation ist ein **privater Arbeitsbereich für eine einzelne bedienende Person** auf deinem Computer oder Server. Du wählst den Modellanbieter und behältst deine eigenen Zugangsdaten. Die öffentliche Website hilft beim Einstieg in die Installation; deine Aufgaben laufen in deinem eigenen Arbeitsbereich.

| Mit einer Aufgabe anfangen                                     | Oder eine wiederkehrende Verantwortung vergeben                                |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Drei Produkte anhand verlinkter Quellen vergleichen.           | Täglich eine öffentliche Seite prüfen und relevante Änderungen festhalten.     |
| Eine CSV-Datei auf fehlende oder doppelte Werte prüfen.        | Einen regelmäßig erscheinenden Bericht nach Zeitplan prüfen.                   |
| Ein Repository prüfen und eine getestete Änderung vorschlagen. | Eine feste Checkliste wiederholen und das Ergebnis jedes Durchlaufs speichern. |

Dies sind Beispielaufträge, keine garantierten Ergebnisse. Das Ergebnis hängt vom Modell, den verfügbaren Werkzeugen, den Berechtigungen und deinen Angaben ab.

## Schnellstart

### 1. Installationsweg wählen

|                     | Fertiges Containerpaket                                                                                                             | Native Installation aus dem Quellcode                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Geeignet für**    | Den Einstieg mit der vorgefertigten Anwendung                                                                                       | Die direkte Arbeit mit Quellcode und Werkzeugen des Hostsystems                                          |
| **Voraussetzungen** | Node.js 24 sowie Docker mit laufender Linux-Engine und Compose v2                                                                   | Git, Node.js 24, die festgelegte pnpm-Version, PostgreSQL; Chromium für Browserwerkzeuge                 |
| **Anwendungsbuild** | Wird automatisch als Image mit festgelegter Version heruntergeladen                                                                 | Wird auf deinem Rechner erstellt                                                                         |
| **Hier beginnen**   | [Setup-ZIP herunterladen](https://github.com/halittayyar0/Agentic-Company-OS/releases/latest/download/Agentic-Company-OS-setup.zip) | [Anleitung zur nativen Installation](./docs/self-hosting.md#guided-installation-windows-linux-and-macos) |

Das Containerpaket enthält PostgreSQL und Chromium. Git, pnpm und ein eigener Build aus dem Quellcode sind dafür nicht erforderlich. Lokale KI-Modelle stellen zusätzliche Hardwareanforderungen, die vom gewählten Modell abhängen.

### 2. Installationsassistenten öffnen

Entpacke die Setup-ZIP und starte die Installation aus dem entpackten Ordner:

| Betriebssystem | Ausführen                                |
| -------------- | ---------------------------------------- |
| Windows        | `START.cmd` doppelt anklicken            |
| macOS / Linux  | `sh START.command` im Terminal ausführen |

Öffne den **privaten lokalen Link**, der im Terminal erscheint. Wähle Sprache, Modellanbieter, Berechtigungen und Werkzeugpakete. Der Assistent erstellt die Datenbank und prüft, ob der Arbeitsbereich bereit ist.

**Bewahre das entpackte Paket und das angezeigte Installationsverzeichnis auf.** Sie werden zum Neustart und zur Fortsetzung einer unterbrochenen Installation benötigt. [Neustart, Sicherungen und Servereinrichtung →](./docs/self-hosting.md)

### 3. Einen klaren ersten Auftrag geben

Erstelle ein Projekt, wähle einen Agenten und beschreibe das gewünschte Ergebnis. Beginne mit etwas, das du leicht prüfen kannst:

> Vergleiche drei Optionen für [Thema]. Nutze Primärquellen, nenne Links und Datumsangaben und speichere einen einseitigen Vergleich. Verwende einen Agenten weiter, solange keine unabhängigen Arbeiten nötig sind. Frage nach, wenn wesentliche Informationen fehlen.

Bei wiederkehrender Arbeit gib sowohl das Zeitintervall als auch die Abschlussbedingung jedes Durchlaufs an:

> Prüfe [öffentliche Seite] alle 24 Stunden auf relevante Änderungen. Speichere bei Änderungen eine datierte Zusammenfassung. Schließe jeden Durchlauf ab und warte auf den nächsten geplanten Zeitpunkt. Kontaktiere niemanden und veröffentliche nichts extern.

**Ein hilfreicher Auftrag enthält:** Eingabedaten, erwartetes Ergebnis, Prüfkriterien sowie Grenzen für Aktionen und Ausgaben.

## Orientierung im Arbeitsbereich

| Bereich                              | Wofür er da ist                                                                                 |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- |
| **Startseite**                       | Agenten, laufende Arbeit und letzte Aktivitäten sehen.                                          |
| **Projekte**                         | Auftrag, Gespräche, delegierte Aufgaben, Besprechungen und Ergebnisse zusammenhalten.           |
| **Experten und Team Studio**         | Rollen und Modelle der Agenten bearbeiten oder mit einer Teamvorlage starten.                   |
| **Skills und Werkzeuge**             | Arbeitsanleitungen durchsehen, Werkzeuganforderungen prüfen und einen Projektentwurf erstellen. |
| **Freigaben**                        | Aktionen prüfen, die vor der Ausführung deine Entscheidung benötigen.                           |
| **Betrieb und Ausführungsinspektor** | Ausführungsprotokolle, Werkzeugaktivitäten, Unterbrechungen und Wiederherstellung prüfen.       |
| **Company Room**                     | Mit ausgewählten Agenten sprechen und einzelne Teilnehmer durch Erwähnungen ansprechen.         |
| **Einstellungen**                    | Modellverbindungen, Sprache, Ausführungsregeln und Quellcode-Arbeitsbereiche konfigurieren.     |

Ein **Skill** ist eine Anleitung für eine Aufgabe. Ein **Werkzeug** führt eine Aktion aus, etwa Daten zu prüfen oder einen Browser zu bedienen. Ein **Agent** nutzt Anweisungen, ein Modell und erlaubte Werkzeuge zur Bearbeitung einer Aufgabe.

## Nützliche Werkzeuge und Platz für Erweiterungen

Die integrierte Bibliothek umfasst **Recherche, Software, Daten, Dokumente und Betriebsabläufe**. Sie enthält Arbeitsanleitungen, Funktionswerkzeuge und Werkzeuge zur Ausführung von Aufgaben. Agenten können Anleitungen finden und bei Bedarf laden.

- **Eigene Anleitungen einbringen.** Persönliche Skills und Hilfswerkzeug-Vorlagen erstellen, bearbeiten, importieren oder exportieren.
- **Ausführbare Werkzeuge hinzufügen.** Node-Werkzeuge im Editor definieren; ihre Ausführung unterliegt den eingestellten Berechtigungs- und Freigaberegeln. [Werkzeuge erstellen →](./docs/personal-programs.md)
- **Am Quellcode arbeiten.** Ein Git-Repository verbinden, einen Agenten Änderungen in einer isolierten Kopie vorbereiten lassen, Unterschiede prüfen und vor dem Übernehmen Tests ausführen. Die Bereitstellung ist ein eigener Schritt. [Quellcode-Arbeitsablauf →](./docs/source-workspaces.md)

[Anleitung zu Skills und Werkzeugen →](./docs/skills-and-tools.md)

## Aufwand passend zur Aufgabe

Routineaufgaben beginnen mit der kostengünstigen Modellauswahl. Zusätzliche Werkzeugdefinitionen werden bei Bedarf geladen. Vorhandene Agenten lassen sich weiterverwenden; der Server prüft die Delegation. Standardmäßig sind **vier aktive Aufgaben je Aufgabenfamilie** erlaubt, einschließlich der übergeordneten Aufgabe.

Eine übergeordnete Aufgabe, die auf aktive Unteraufgaben wartet, sendet keine Modellanfragen. Wiederkehrende Arbeit wartet zwischen geplanten Durchläufen. Die Nutzungskontrolle berücksichtigt Ausführungs- und Prüfanfragen mit Grenzen je Aufgabe bzw. Durchlauf sowie einem gleitenden Tageskontingent für wiederkehrende Arbeit.

**Du steuerst die Modellkosten.** Cloudanbieter rechnen über dein eigenes Konto ab; lokale Modelle nutzen deine Hardware. Eine ausdrückliche Auswahl kostenloser oder lokaler Modelle wechselt nicht unbemerkt zu kostenpflichtigen Modellen. Eine bereits laufende Anfrage kann die erfasste Nutzungsgrenze überschreiten; fehlende Kostenangaben bleiben unbekannt. Für eine feste Rechnungsobergrenze nutze die Limits des Anbieters.

[Modellauswahl, Delegation und Budgeteinstellungen →](./docs/efficient-work.md)

## Dein Arbeitsbereich, deine Zugriffsentscheidungen

Wähle bei der Einrichtung oder in den Einstellungen **nur lesenden Zugriff, Zugriff mit Freigabe, Vollzugriff oder eine eigene Richtlinie**. Vollzugriff erlaubt mehr Aktionen innerhalb aktivierter Werkzeuge; die Ausführung auf dem Host hat weiterhin eigene Einstellungen und Kontrollen. Lies das [Sicherheitsmodell](./docs/security-model.md), bevor du weitreichenden Hostzugriff erlaubst.

**Auf dem Smartphone:** Öffne dieselbe responsive Oberfläche über privates HTTPS. Der optionale Einrichtungsweg verwendet eine vorhandene Tailscale-Verbindung; ein selbst verwaltetes VPN ist ebenfalls dokumentiert. Der Host muss online bleiben. [Zugriff vom Smartphone →](./docs/mobile-access.md)

**In deiner Sprache:** English · Türkçe · Deutsch · Русский · 简体中文 · 繁體中文 · العربية. Arabisch unterstützt eine Anordnung von rechts nach links. Eigene Anweisungen, externe Ausgaben und bisherige Aufzeichnungen behalten ihren Originaltext. [Umfang der Übersetzungen →](./docs/localization.md)

> [!NOTE]
> Die Anwendung unterstützt derzeit eine vertrauenswürdige bedienende Person je Installation. Gemeinsam genutzte Mehrbenutzerkonten und Mandantentrennung sind nicht enthalten. Halte den Fernzugriff privat und schütze ihn mit HTTPS und einer Authentifizierung für die bedienende Person.

## Was überprüft wurde

Die **Version 0.2.0** enthält ein vorgefertigtes Linux-Image für amd64/arm64 und einen Installationsassistenten. Die dokumentierte Abnahme umfasst:

- **1.479 bestandene Quellcode-Tests**, keine Fehler und sechs umgebungsbedingte Auslassungen; PostgreSQL-Parallelitätsprüfungen laufen separat.
- **922 bestandene Browsertests** sowie Prüfungen unter Windows, auf Intel-Macs und Macs mit Apple Silicon.
- Tatsächliche Containerinstallation und deren Fortsetzung, kurze Wiederherstellungs- und Dauertests sowie begrenzte Nachweise mit einem echten Modell für eine endliche Aufgabe und zwei wiederkehrende Durchläufe.
- Anonyme Paketdownloads, übereinstimmende Prüfsummen und Prüfungen der öffentlichen Startseite in sieben Sprachen bei Smartphone-Breite.

Diese Ergebnisse gelten für die genannte Version. Ein 24-Stunden-Dauertest, Abnahmetests mit echten Smartphones und Mobilfunkverbindungen sowie die Prüfung durch Muttersprachler stehen noch aus. Offene Aufgaben können deine Mitwirkung erfordern; der Abschluss jeder denkbaren Aufgabe ist nicht garantiert.

[Version und Nachweise](https://github.com/halittayyar0/Agentic-Company-OS/releases/tag/v0.2.0) · [Aktuelle CI](https://github.com/halittayyar0/Agentic-Company-OS/actions) · [Prüfumfang](./docs/verification/2026-09-29-efficient-autonomy.md)

## Weiterführende Informationen

| Ich möchte …                                                     | Passende Dokumentation                                                   |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Einen Arbeitsbereich installieren, neu starten oder sichern      | [Eigenbetrieb](./docs/self-hosting.md)                                   |
| Umgebungsvariablen konfigurieren oder Entwicklungsserver starten | [Referenz für Betrieb und Entwicklung](./docs/operator-reference.md)     |
| API, Worker und Datenbank verstehen                              | [Architektur](./docs/architecture.md)                                    |
| Berechtigungen und verbleibende Risiken verstehen                | [Sicherheitsmodell](./docs/security-model.md)                            |
| Änderungen und geplante Arbeit verfolgen                         | [Änderungsprotokoll](./CHANGELOG.md) · [Roadmap](./docs/roadmap.md)      |
| Code, Dokumentation oder Übersetzungen beitragen                 | [Mitwirken](./CONTRIBUTING.md) · [Verhaltenskodex](./CODE_OF_CONDUCT.md) |
| Eine Sicherheitslücke vertraulich melden                         | [Sicherheitsmeldungen](./SECURITY.md)                                    |

Die verlinkte technische Dokumentation ist überwiegend auf Englisch. Kleine, gezielte Beiträge sind willkommen: ein reproduzierbarer Fehlerbericht, eine klarere Übersetzung, eine nützliche Anleitung oder eine getestete Korrektur.

**Modellverbindung ab v0.4.0:** Die [Anleitung zur Modellverbindung](./docs/model-connections.de.md) erklärt lokale Modelle, ChatGPT, API-Schlüssel und den Erhalt des ersten Auftragsentwurfs. Frühere Installationspakete enthalten diesen Ablauf nicht.

Öffne **Modellnutzungsprotokolle** bei einem Projekt oder Agenten, um eine Anfrage nach einer Unterbrechung zu prüfen. Die Prüfung verbraucht keine Modell-Tokens und sendet die Anfrage nicht erneut; unbekannte Nutzung wird nicht als null gezählt. [Nutzungsprotokolle verstehen →](./docs/inference-accounting.md)

---

**Open Source unter der [MIT-Lizenz](./LICENSE).** Die mitgelieferten IBM-Plex-Schriften stehen unter der SIL Open Font License 1.1; siehe [Drittanbieterhinweise](./artifacts/agentic-company-os/public/THIRD_PARTY_NOTICES.txt).
