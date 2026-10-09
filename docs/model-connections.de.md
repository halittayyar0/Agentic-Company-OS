# Ein Modell verbinden, den ersten Auftrag behalten

[English](./model-connections.md) · [Türkçe](./model-connections.tr.md) · [Deutsch](./model-connections.de.md) · [Русский](./model-connections.ru.md) · [简体中文](./model-connections.zh-CN.md) · [繁體中文](./model-connections.zh-TW.md) · [العربية](./model-connections.ar.md)

> Für v0.4.0 und neuer. Frühere Installationspakete enthalten diesen Ablauf nicht.

## Mit dem gewünschten Ergebnis beginnen

Schreibe deinen Auftrag auf der Startseite oder unter Neues Projekt und öffne
die Modellverbindung. Schließen, Login-Abbruch und Sprachwechsel senden keinen
Auftrag ab. Du startest ihn ausdrücklich. Bei verweigertem Browserspeicher
erklärt eine Warnung, was beim Neuladen verloren gehen kann.

| Auswahl        | Voraussetzung                                           | Was das Speichern bestätigt                                                                |
| -------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Lokales Modell | Ollama-Server mit installiertem, werkzeugfähigem Modell | Adresse und erkannte Modelle; kein Download oder Inferenztest                              |
| ChatGPT        | Berechtigtes Konto und Erlaubnis zur Modellnutzung      | Geprüfte Registrierung und separate Auswahl; Verfügbarkeit und Kontingent gelten weiterhin |
| API-Schlüssel  | Eigener OpenAI- oder OpenRouter-Schlüssel               | Gespeicherte Konfiguration; der Anbieter kann Gebühren berechnen                           |

Der **Backend-Server** muss Ollama erreichen. `localhost` auf dem Telefon meint
das Telefon, im Container den Container. Verwende eine erreichbare private
Adresse. Die Installationsvorgabe entfernt den gespeicherten Ersatzwert; eine
Umgebungsverbindung kann aktiv bleiben.

## Vor dem Start prüfen

Erkannt, verbunden und getestet sind verschiedene Zustände. Der ausdrückliche
Modelltest in den erweiterten Einstellungen sendet eine Anfrage; Speichern tut
das nicht. Bereits gestartete, wartende Aufträge können nach dem Speichern
weiterlaufen. Bei unbestätigtem Ergebnis zuerst den aktuellen Zustand prüfen.

ChatGPT-Konto speichern und auswählen sind getrennte Schritte. Eine reine
Identitätsanmeldung erlaubt keine Modellnutzung. Nutze für Server oder Container
vom eigenen Rechner die [geschützte Übertragung](./chatgpt-connection.md#on-a-server-or-in-a-container).
Das Telefon erreicht den lokalen Login-Rückkanal des Servers nicht. Zugangsdaten
niemals in die Browseroberfläche einfügen.

Prüfe Berechtigungen und gewünschte Ausgabe und starte den Auftrag.
[Privater Telefonzugriff](./mobile-access.md) nutzt dieselbe Weboberfläche.
Die optionale native Codex-Ausführung hat [eigene Plattformanforderungen](./chatgpt-connection.md#optional-governed-coding-runtime);
eine Modellverbindung aktiviert sie nicht automatisch.

Meldet ein Modell den Tokenverbrauch nicht, werden der Auftrag und seine
Teilaufgaben vor weiteren Aufrufen angehalten. Die Aufzeichnungen bleiben
erhalten. Prüfen Sie die Aufrufe und beginnen Sie einen neuen Auftrag mit einem
Anbieter, der den Verbrauch meldet. Fehlende Dollarpreise bleiben unbekannt,
auch wenn der Tokenverbrauch vollständig gemeldet wurde.

## Optionale Einrichtung für Programmieraufgaben

Der Container-Installer bietet eine separate, zunächst deaktivierte Option **Codex für Programmieraufgaben**. Sie erfordert eine Linux-x64-Engine, Compose ab 2.24.4 und Terminalzugriff. Das Werkzeugpaket Code aktiviert sie nicht. Verbinde nach der Einrichtung ein berechtigtes Konto; andere Aufgaben nutzen weiterhin deinen gewählten Anbieter. Bei AppArmor muss die Administration das mitgelieferte Profil laden. Siehe die [Installationsvoraussetzungen](./self-hosting.md#optional-coding-workers).
