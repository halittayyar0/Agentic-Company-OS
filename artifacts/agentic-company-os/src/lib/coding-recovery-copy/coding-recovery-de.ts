import type { CodingRecoveryCopy } from "../coding-recovery-copy";
export default {
  title: "Programmiersitzung",
  description:
    "Setze eine beendete Sitzung zurück, die nicht fortgesetzt werden kann. Dateien und Verlauf bleiben erhalten. Die Aufgabe bleibt angehalten; prüfe ungeklärte Aktionen vor dem Fortsetzen.",
  acknowledge:
    "Ich habe den Aufgabenverlauf geprüft und verstehe, dass ungewisse Aktionen ungeklärt bleiben.",
  reset: "Sitzung archivieren und zurücksetzen",
  checking: "Sitzung wird geprüft…",
  inspect: "Gespeichertes Ergebnis prüfen",
  retry: "Dieselbe Anfrage erneut senden",
  missing:
    "Für diese Anfrage ist noch kein Ergebnis gespeichert. Du kannst dieselbe Anfrage erneut senden.",
  unknown:
    "Das Ergebnis ist nicht bestätigt. Prüfe das gespeicherte Ergebnis vor einer neuen Anfrage.",
  storage:
    "Wiederherstellungsdaten können in diesem Tab nicht sicher gespeichert werden. Prüfe den Browserspeicher und den Aufgabenverlauf vor einem weiteren Versuch.",
  snapshotError:
    "Der Sitzungsstatus konnte nicht geladen werden. Prüfe ihn erneut.",
  success:
    "Sitzung archiviert. Dateien und Nachweise bleiben erhalten. Die Aufgabe wurde nicht neu gestartet; prüfe offene Aktionen vor dem Fortsetzen.",
  reasons: {
    task_missing: "Diese Aufgabe existiert nicht mehr.",
    session_missing:
      "Diese Aufgabe hat keine Programmiersitzung zum Zurücksetzen.",
    revision_changed:
      "Die Sitzung hat sich geändert. Prüfe ihren aktuellen Zustand vor einer neuen Anfrage.",
    revision_exhausted:
      "Die Datensatzversion kann nicht sicher erhöht werden. Wende dich an die Serveradministration.",
    task_active:
      "Die Aufgabe ist noch aktiv oder einem Ausführer zugeordnet. Stoppe sie und warte auf die Bereinigung.",
    session_running:
      "Die Laufzeit ist noch einem Ausführer zugeordnet. Warte auf die bestätigte Beendigung.",
    cleanup_unknown:
      "Die Beendigung ist nicht bestätigt. Eine weitere Laufzeit kann nicht sicher gestartet werden.",
    native_pending:
      "Eine native Aktion wartet noch auf eine Entscheidung oder ein Ergebnis. Prüfe sie zuerst.",
    already_reset:
      "Die vorherige Sitzung ist archiviert. Eine später autorisierte Programmieraufgabe kann eine neue Sitzung beginnen.",
  },
} satisfies CodingRecoveryCopy;
