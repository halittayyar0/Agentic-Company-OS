import type { TerminalCopy } from "../terminal-copy";

export const terminalDe = {
  emptyDirectory: "(leer)",
  usageCat: "Verwendung: cat <Datei>",
  usageMkdir: "Verwendung: mkdir <Verzeichnis>",
  usageTouch: "Verwendung: touch <Datei>",
  usageWrite: "Verwendung: write <Datei> <Inhalt>",
  usageRemove: "Verwendung: rm <Pfad>",
  written: "{path} geschrieben ({bytes} Byte)",
  removed: "{path} gelöscht",
  helpBuiltins: "Integrierte Befehle:",
  helpProcessesEnabled:
    "Externe Programme sind aktiviert: {commands}. Das Arbeitsverzeichnis ist der Arbeitsbereich des Agenten; diese Programme können auf das Hostsystem zugreifen. Die Isolation muss durch einen separaten Container oder eine separate VM gewährleistet werden.",
  helpProcessesDisabled:
    "Externe Programme sind deaktiviert: {commands}. Aktivieren Sie sie mit ALLOW_AGENT_PROCESS_EXEC=true nur innerhalb eines isolierten Containers oder einer isolierten VM; die Befehlsliste ist keine Sicherheitsgrenze.",
  helpDeleteReview:
    "rm/del löscht direkt. Verwenden Sie den Löschablauf auf der Seite „Dateien“, um die Version vor dem Löschen zu prüfen.",
  emptyCommand: "Leerer Befehl.",
  forbiddenCommand:
    "Befehl aus Sicherheitsgründen blockiert: Shell-Umleitungen, Befehlsverkettungen, Anführungszeichen, umgekehrte Schrägstriche und Zeilenumbrüche sind nicht zulässig.",
  commandNotAllowed:
    'Befehl nicht zulässig: "{command}". Mit help erhalten Sie die Liste.',
  processDisabled:
    "Die Ausführung externer Programme ist standardmäßig deaktiviert. Verwenden Sie Dateibefehle oder setzen Sie ALLOW_AGENT_PROCESS_EXEC=true nur innerhalb eines isolierten Containers oder einer isolierten VM.",
  queuedCancelled:
    "Der wartende Agentenbefehl wurde durch den Notstopp abgebrochen.",
  invalidWorkspace: "Ungültige Kennung des Arbeitsbereichs.",
  unsafePath: 'Unsicherer Pfad abgelehnt: "{path}"',
  regularFileReadOnly: "Es können nur reguläre Dateien gelesen werden.",
  readLimit: "Die Datei überschreitet das Leselimit.",
  workspaceSymlink:
    "Der Arbeitsbereich des Agenten darf kein symbolischer Link sein.",
  pathSymlink: "Pfad mit symbolischem Link abgelehnt: {path}",
  directoryMissing: "Verzeichnis nicht gefunden: {path}",
  directoryUnreadable: "Verzeichnis konnte nicht gelesen werden: {path}",
  filePathRequired: "Ein Dateipfad ist erforderlich.",
  fileMissing: "Datei nicht gefunden: {path}",
  fileUnreadable: "Datei konnte nicht gelesen werden: {path}",
  rootReplaceDenied:
    "Das Stammverzeichnis des Arbeitsbereichs kann nicht durch eine Datei ersetzt werden.",
  contentTooLarge: "Der Inhalt ist zu groß (Limit: {bytes} Byte).",
  binaryTooLarge: "Der binäre Inhalt ist zu groß (Limit: {bytes} Byte).",
  pathRequired: "Ein Pfad ist erforderlich.",
  rootDeleteDenied:
    "Das Stammverzeichnis des Arbeitsbereichs kann nicht gelöscht werden.",
  rootNotFile: "Das Stammverzeichnis des Arbeitsbereichs ist keine Datei.",
  regularFileTouchOnly:
    "touch kann nur auf reguläre Dateien angewendet werden.",
  fileChanged:
    "Die Datei wurde seit der Prüfung geändert. Prüfen Sie die neue Version.",
  fileNotEditable: "Diese Datei kann in diesem Ablauf nicht bearbeitet werden.",
  fileVersionRequired:
    "Zum Bearbeiten ist eine geprüfte Dateiversion erforderlich.",
  deleteChanged:
    "Der zu löschende Inhalt wurde seit der Prüfung geändert. Prüfen Sie ihn erneut.",
  deleteMissing: "Der zu löschende Inhalt ist nicht mehr vorhanden.",
  deleteNotReviewable:
    "Der zu löschende Inhalt überschreitet die Grenzen für eine sichere Prüfung.",
  deleteVersionRequired:
    "Zum Löschen ist eine geprüfte Version erforderlich. Verwenden Sie die Löschprüfung auf der Seite „Dateien“.",
  commandRequired: "command ist erforderlich.",
  sudoCommandTooLong:
    "Der sudo-Befehl darf höchstens {limit} Zeichen lang sein.",
  sudoCommandControls:
    "Der sudo-Befehl darf keine ASCII-Steuerzeichen oder bidirektionalen Unicode-Steuerzeichen enthalten.",
  sudoWorkspaceSymlink:
    "Der Arbeitsbereich für Agenten-sudo darf kein symbolischer Link sein.",
  sudoDisabled:
    "Agenten-sudo ist deaktiviert (zum Aktivieren ist ALLOW_AGENT_SUDO=true erforderlich).",
  sudoAuthorityDenied:
    "Die Berechtigung für Agenten-sudo wurde bei der Live-Identitätsprüfung verweigert.",
  sudoTargetUnverified:
    "Der physische Arbeitsbereich für Agenten-sudo konnte nicht verifiziert werden.",
  sudoTargetMismatch:
    "Die Bindung an Host und Arbeitsbereich für Agenten-sudo stimmte nicht überein.",
  sudoAuthorityChanged:
    "Die Berechtigung für Agenten-sudo wurde nach der Auswirkungsgrenze verweigert.",
  sudoTargetRecheckFailed:
    "Der physische Arbeitsbereich für Agenten-sudo konnte nicht erneut verifiziert werden.",
  sudoTargetChanged:
    "Die Bindung an Host und Arbeitsbereich für Agenten-sudo stimmte nach der Auswirkungsgrenze nicht überein.",
  founderDisabled:
    "Founder shell ist deaktiviert (zum Aktivieren ist ALLOW_FOUNDER_SHELL=true erforderlich).",
  terminalPermissionDenied:
    "Fehler: Dieser Agent hat keine Berechtigung für das virtuelle Terminal.",
  errorPrefix: "Fehler: {message}",
  approvalRequired:
    "BLOCKIERT: {toolName} erfordert eine einmalige Benutzerfreigabe mit festgelegtem Geltungsbereich. Rufen Sie request_approval mit category={category}, toolName={toolName}, toolArgs={args} auf. Versuchen Sie diese oder eine gleichwertige Aktion erst, wenn die Freigabe erteilt wurde.",
  sudoRootOnly:
    "BLOCKIERT: CEO Host Shell steht ausschließlich dem obersten CEO-Agenten zur Verfügung.",
  sudoPermissionDenied:
    "BLOCKIERT: Der oberste CEO-Agent hat keine Berechtigung für die Host-Shell.",
  sudoApprovalRequired:
    "BLOCKIERT: vm_run_sudo_command erfordert für jeden exakten Befehl eine separate, einmalige Benutzerfreigabe. Rufen Sie request_approval mit toolName=vm_run_sudo_command und demselben vorgeschlagenen command in toolArgs auf; der Server erstellt den kritischen Freigabetext und das Ziel selbst. Halten Sie an, bis die Freigabe erteilt wurde.",
  terminalDispatch: "Terminal-Befehl wird gesendet",
  sudoDispatch: "Freigegebener Terminal-Befehl wird gesendet",
  terminalExecuted:
    "{name} hat {command} auf dem eigenen virtuellen Computer ausgeführt.",
  terminalFailed:
    "Bei {name} ist ein Fehler bei einem Terminal-Befehl aufgetreten.",
  sudoExecuted:
    "Der freigegebene CEO Host Shell-Befehl wurde für {name} ausgeführt (exitCode={exitCode}).",
  sudoFailed:
    "Bei {name} ist ein Fehler bei einem freigegebenen Terminal-Befehl aufgetreten.",
  terminalFailureFallback: "Terminal-Befehl fehlgeschlagen",
  sudoFailureFallback: "Freigegebener Terminal-Befehl fehlgeschlagen",
  terminalError: "Terminal-Fehler: {message}",
  noOutput: "(keine Ausgabe)",
  interrupted: "(Befehl vor Abschluss unterbrochen)",
  exitCode: "(Exitcode: {code})",
  note: " [Hinweis: {note}]",
  operatorComplete: "Operatoranfrage abgeschlossen",
  operatorReview: "Das Ergebnis der Operatoranfrage muss geprüft werden",
  invalidToolJson: "Fehler: Die Werkzeugargumente enthalten ungültiges JSON.",
  invalidToolObject:
    "Fehler: Die Werkzeugargumente müssen ein JSON-Objekt sein.",
  exclusiveTools:
    "BLOCKIERT: {toolName} gehört nicht zu den für diesen Durchlauf zulässigen Werkzeugen. Zulässige Werkzeuge: {tools}. Versuchen Sie dieselbe Aktion nicht auf einem anderen Weg.",
  exclusiveSudoMismatch:
    "BLOCKIERT: command stimmt nicht exakt mit dem vom Benutzer angegebenen Befehl überein. Ändern Sie den Befehl nicht und führen Sie keinen gleichwertigen Befehl aus.",
  emergencyBlocked:
    "BLOCKIERT: Der Notstopp wurde aktiviert oder sein Zustand hat sich während der Ausführung geändert; der Terminal-Vorgang wurde gestoppt.",
  agentInactive:
    "BLOCKIERT: Der Agent wurde deaktiviert; das Werkzeug wurde nicht ausgeführt.",
  categoryRevoked:
    "BLOCKIERT: Die Berechtigung des Agenten für die Freigabekategorie wurde entzogen; die Aktion wurde nicht ausgeführt.",
  taskLeaseMissing:
    "BLOCKIERT: Die Berechtigung zur Aufgabenausführung fehlt; das Werkzeug wurde nicht ausgeführt.",
  taskLeaseLost:
    "BLOCKIERT: Die Aufgabe wurde gestoppt oder die Ausführungsberechtigung für die Aufgabe, den Agenten oder den Ausführungsversuch ging verloren.",
  operationLeaseLost:
    "BLOCKIERT: Die Berechtigung zur Ausführung des Vorgangsaufrufs ging verloren.",
  taskBoundary: "Werkzeuggrenze · {tool}",
  computerBoundary: "Computerschritt · {tool}",
  computerStarted: "{name} hat einen Computerschritt begonnen: {tool}.",
  stepStart: "Start",
  replayComplete:
    "Der Vorgang wurde bereits abgeschlossen; die externe Wirkung wurde nicht erneut ausgelöst.{evidence}",
  safeEvidence: " Sicherer Nachweis: {data}.",
  receiptUnknown:
    "Das Ergebnis des Vorgangs ist ungewiss; ein automatischer Wiederholungsversuch wurde blockiert. Receipt: {id}.",
  receiptFailed:
    "Der Vorgang wurde endgültig als fehlgeschlagen abgeschlossen. Receipt: {id}.",
  receiptBusy:
    "Derselbe logische Vorgang wird von einem anderen Worker ausgeführt. Receipt: {id}.",
  effectFailure:
    "Der Vorgang konnte nicht sicher abgeschlossen werden; unverarbeitete Fehlerdaten oder Ausgaben wurden nicht gespeichert.",
  approvedAction: "Freigegebene Aktion · {tool}",
  approvedScopeInvalid:
    "Fehler: Die Integrität des Geltungsbereichs der freigegebenen Aktion konnte nicht verifiziert werden.",
  approvedAgentMissing:
    "Fehler: Der Agent für die freigegebene Aktion wurde nicht gefunden oder ist inaktiv.",
  computerSelected: "{name} hat den nächsten Computerschritt gewählt: {tool}.",
  computerDeferred:
    "ZURÜCKGESTELLT: {tool} kann nicht sicher ausgeführt werden, bevor das Ergebnis des vorherigen Computerschritts in derselben Gruppe von Modellaktionen gesichtet wurde. Prüfen Sie das vorherige Werkzeugergebnis; verwenden Sie bei Bedarf computer_observe, um den aktuellen Zustand zu sehen, und schlagen Sie diese Aktion im nächsten Durchlauf erneut vor.",
  approvedCompleted:
    "Die freigegebene Aktion {tool} wurde abgeschlossen (exitCode={exitCode}).",
  approvedFailed:
    "Die freigegebene Aktion {tool} ist fehlgeschlagen (exitCode={exitCode}).",
  approvedUnknown:
    "Das Ergebnis der freigegebenen Aktion konnte nicht verifiziert werden; ein automatischer Wiederholungsversuch wurde blockiert. Eine Prüfung durch den Operator ist erforderlich.",
  unknownFinalization: "Unbekannter Fehler beim Speichern des Ergebnisses",
  invocationExpired:
    "BLOCKIERT: Die Ausführungsberechtigung des Vorgangs ist abgelaufen.",
  runtimeUnavailable:
    "BLOCKIERT: Die Laufzeitumgebung ist nicht mehr zur Ausführung dieses Vorgangs berechtigt.",
  agentAuthorityLost:
    "BLOCKIERT: Die Ausführungsberechtigung des Agenten ist abgelaufen oder wurde geändert.",
  taskAuthorityLost:
    "BLOCKIERT: Die Ausführungsberechtigung der Aufgabe ist abgelaufen oder wurde geändert.",
  operationStateInvalid:
    "Der Zustand des Vorgangs konnte nicht verifiziert werden. Eine Prüfung durch den Betreiber ist erforderlich.",
  commandNotStarted: "(Befehl wurde nicht gestartet)",
  scopeActivated:
    "Die Bereichsbeschränkung ist aktiv. Für diesen Chat-Schritt erlaubte Werkzeuge: {tools}.",
  taskUnknownStopped:
    "Das Ergebnis des Vorgangs ist unbekannt; die Aufgabe und weitere Werkzeugaufrufe wurden gestoppt. Eine automatische Wiederholung ist gesperrt.",
  taskDeferred:
    "Ein anderer Worker führt den Vorgang aus; die Aufgabe wurde für einen sicheren erneuten Versuch eingereiht.",
} satisfies TerminalCopy;
