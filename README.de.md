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

### 1. Das native Paket herunterladen

Wähle unter [Releases](https://github.com/halittayyar0/Agentic-Company-OS/releases/latest) das passende aktuelle Installationsarchiv und prüfe Version sowie Prüfsumme. Node.js, PostgreSQL und die fertige App sind enthalten. Node.js, Docker, pnpm, Git und PostgreSQL müssen nicht separat installiert werden.

| System              | Archiv                                   |
| ------------------- | ---------------------------------------- |
| Windows x64         | `Agentic-Company-OS-win32-x64.zip`       |
| macOS Intel         | `Agentic-Company-OS-darwin-x64.tar.gz`   |
| macOS Apple Silicon | `Agentic-Company-OS-darwin-arm64.tar.gz` |
| Linux x64           | `Agentic-Company-OS-linux-x64.tar.gz`    |
| Linux ARM64         | `Agentic-Company-OS-linux-arm64.tar.gz`  |

Ziele: Windows 10 (1903+)/11 x64, macOS 15 auf Intel/Apple Silicon und Ubuntu 24.04 auf x64/ARM64. Linux-Pakete basieren auf Ubuntu 24.04/glibc; ältere glibc und Alpine/musl sind keine unterstützten Ziele. Windows ARM64 ist kein natives Ziel. Windows/macOS-Pakete sind unsigniert; Notarisierung und SmartScreen-Reputation werden nicht bereitgestellt. Prüfe normale Systemwarnungen und die Prüfsumme, ohne den Systemschutz zu deaktivieren.

### 2. Den Arbeitsbereich öffnen

Entpacke das **gesamte Archiv** in einen Ordner. Doppelklicke unter Windows auf `START.cmd`. Öffne unter macOS `START.command` oder führe unter macOS/Linux `./START.command` im Terminal aus. Halte die Paketdateien zusammen. Der Launcher öffnet einen privaten lokalen Browserlink und zeigt ihn im Terminal. Wähle eine der sieben Sprachen, prüfe Berechtigungen und verbinde ein Modell.

Die App bindet standardmäßig an Loopback (`127.0.0.1`). Lass das Terminal geöffnet; **Strg+C** stoppt App, Worker und private Datenbank. Ohne Browser: `START.cmd --no-browser` oder `./START.command --no-browser`. Daten und Schlüssel bleiben im privaten Installationsordner außerhalb des Pakets. Bewahre ihn und das ursprüngliche Paket auf; ein erneuter Start desselben Pakets am ursprünglichen Ort setzt die gespeicherte Installation fort. Paketwechsel und Upgrades sind nicht automatisiert: Erstelle eine überprüfte Sicherung und folge der [Upgrade-Anleitung](./docs/self-hosting.md#upgrades).

Modellgewichte und Anbieterzugang sind nicht enthalten. KI-Aufgaben brauchen ein eingerichtetes Ollama-Modell oder eine verfügbare Anbieterverbindung; Cloud-Anbieter können Gebühren berechnen. Lokale Hilfsprüfungen funktionieren ohne kostenpflichtigen Anbieter.

Erweiterte Optionen: Das separate [Docker-Paket](./docs/self-hosting.md#portable-container-installer) und die [Quellcode-Installation](./docs/self-hosting.md#source-installation-prerequisites) behalten ihre eigenen Voraussetzungen.

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
