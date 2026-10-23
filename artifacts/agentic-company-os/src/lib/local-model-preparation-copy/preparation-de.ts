import type { ModelPreparationCopy } from "../local-model-preparation-copy";
export default {
  pendingHint:
    "Bestehende Aufgaben, die auf dieses Modell warten, können fortgesetzt werden.",
  title: "Ein lokales Modell einrichten",
  description:
    "Lade ein kleines Einstiegsmodell auf deinen gespeicherten Ollama-Server herunter.",
  download: "Modell herunterladen",
  stop: "Download stoppen",
  checking: "Das heruntergeladene Modell wird geprüft",
  returnToJob: "Zurück zu meiner Aufgabe",
  available: "Ein lokales Modell ist verfügbar",
  preparing: "Download wird vorbereitet",
  downloading: "Modelldateien werden heruntergeladen",
  stopping: "Diese Downloadanfrage wird gestoppt",
  interrupted:
    "Download unterbrochen. Prüfe das Modell vor einem neuen Versuch. Teildateien können auf dem Server verbleiben.",
  failed:
    "Der Download konnte nicht bestätigt werden. Prüfe vor einem neuen Versuch den Server.",
  unknown:
    "Der Empfang der Downloadanfrage ist unbestätigt. Prüfe den Status oder stoppe diese Anfrage vor einem neuen Versuch.",
  check: "Download prüfen",
  install: "Ollama installieren oder aktualisieren",
  where:
    "Wähle das Betriebssystem des Computers oder Servers, auf dem das Modell laufen soll.",
  storage:
    "Etwa 2 GB Modelldateien sowie freier Platz für temporäre Dateien. Verwendet Netzwerk und Festplatte des verbundenen Computers oder Servers, nicht den Speicher deines Telefons.",
  saveFirst: "Speichere und prüfe die Serveradresse vor dem Download.",
  continues:
    "Du kannst dieses Fenster beim Download schließen. Stoppen betrifft diese Anfrage; andere Clients können weiter herunterladen.",
  reset:
    "Der Server hat einen Teil der Übertragung neu gestartet. Die beobachtete Bytezahl ist gesunken.",
  unavailable:
    "Ollama ist nicht erreichbar. Installiere oder starte es auf dem Computer oder Server, der das Modell ausführen soll, und prüfe erneut.",
  update:
    "Dieses Einstiegsmodell benötigt Ollama 0.40.3 oder neuer. Aktualisiere den verbundenen Server und prüfe erneut.",
  changed:
    "Die gespeicherte Verbindung wurde geändert. Prüfe vor einem neuen Download den aktuellen Server.",
  readyHint:
    "Kehre zu deinem Entwurf zurück und entscheide, wann du startest. Bestehende Aufgaben, die auf dieses Modell warten, können fortgesetzt werden.",
  bytes: "Beobachtete Modelldaten",
} satisfies ModelPreparationCopy;
