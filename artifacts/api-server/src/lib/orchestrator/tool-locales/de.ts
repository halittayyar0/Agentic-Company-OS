import type { ToolCopy } from "../tool-copy";

export const toolDe: ToolCopy = {
  budgetFamilyResumed:
    "Nutzungslimit geprüft; {count} Aufgaben erneut eingereiht.",
  schedulerClaimed: "Aufgabe übernommen",
  projectMeetingRunning:
    "Antwort für die Projektbesprechung wird vorbereitet: {title}",
  schedulerAccepted: "Aufgabe angenommen; die Arbeit hat begonnen.",
  schedulerRecovered:
    "Die unterbrochene Arbeit wurde wiederhergestellt und erneut eingereiht.",
  schedulerRecoveryPaused:
    "Die unterbrochene Arbeit wurde wiederhergestellt; die Ausführung bleibt durch den Notstopp pausiert.",
  schedulerRecoveryPausedNote:
    "Die Zuständigkeit für die unterbrochene Arbeit wurde freigegeben; die Ausführung bleibt bis zur Aufhebung des Notstopps pausiert.",
  schedulerRecoveryNote:
    "Die Zuständigkeit für die unterbrochene Arbeit wurde freigegeben; die Aufgabe wurde erneut eingereiht.",
  schedulerStepBudget: "Schrittlimit des Betreibers erreicht ({used}/{limit}).",
  schedulerTokenBudget: "Tokenbudget erreicht ({used}/{limit}).",
  schedulerUnreportedTokenUsage:
    "Der Tokenverbrauch für diesen Auftrag wurde nicht vollständig gemeldet. Weitere Modellaufrufe sind angehalten, damit keine ungemessenen Kosten entstehen. Prüfen Sie die protokollierten Aufrufe; starten Sie zum Fortfahren einen neuen Auftrag mit einem Anbieter, der den Tokenverbrauch meldet. Die bisherigen Aufzeichnungen bleiben erhalten.",
  schedulerCostBudget:
    "Vom Anbieter gemeldetes Kostenbudget erreicht (${used}/{limit}).",
  schedulerFamilyTokenBudget:
    "Gemeinsames Tokenbudget für Aufgabe #{rootTaskId} und ihre Unteraufgaben erreicht ({used}/{limit}).",
  schedulerFamilyCostBudget:
    "Gemeinsames Kostenbudget laut Anbieter für Aufgabe #{rootTaskId} und ihre Unteraufgaben erreicht (${used}/{limit}).",
  schedulerFamilyDailyTokenBudget:
    "Gemeinsames Tokenbudget der letzten 24 Stunden für Aufgabe #{rootTaskId} und ihre Unteraufgaben erreicht ({used}/{limit}).",
  schedulerFamilyDailyCostBudget:
    "Gemeinsames Kostenbudget laut Anbieter der letzten 24 Stunden für Aufgabe #{rootTaskId} und ihre Unteraufgaben erreicht (${used}/{limit}).",
  schedulerBudgetStopped:
    "Aufgabe wegen ihres Sicherheitsbudgets angehalten: {reason}",
  pathInvalid: "Fehler: path muss eine Zeichenfolge sein.",
  pathNoncanonical:
    "Fehler: path darf nicht mit Leerraum beginnen oder enden; Dateinamen werden nicht stillschweigend geändert.",
  teamToolNameInvalid:
    "Fehler: toolName muss die genaue Werkzeugkennung ohne umgebenden Leerraum sein.",
  directoryObserved:
    "{shown} von {count} erfassten Einträgen werden angezeigt.",
  directoryScanLimited:
    "Die Verzeichnissuche hat ihr Limit erreicht; weitere Einträge können vorhanden sein.",
  directoryEntriesSkipped: "Nicht prüfbare Einträge: {count}.",
  pathRequired: "Fehler: Ein nicht leerer path ist erforderlich.",
  contentRequired:
    "Fehler: content muss eine Zeichenfolge sein; für eine leere Datei ausdrücklich eine leere Zeichenfolge senden.",
  listDispatch: "Dateiliste wird gelesen",
  readDispatch: "Datei wird gelesen",
  writeDispatch: "Datei wird geschrieben",
  directoryEmpty: "Verzeichnis ist leer: /{path}",
  directoryFile: "[FILE] {path} ({bytes} Byte)",
  directoryTotal: "(insgesamt {count} Einträge)",
  directoryListed: "{name} hat das Verzeichnis aufgelistet: /{path}",
  directoryEmptyListed:
    "{name} hat ein leeres Verzeichnis aufgelistet: /{path}",
  directoryListFailed:
    "Beim Auflisten des Verzeichnisses ist für {name} ein Fehler aufgetreten.",
  fileRead: "{name} hat die Datei gelesen: {path}",
  fileWritten:
    "{name} hat eine Datei im Arbeitsbereich geschrieben: {path} ({bytes} Byte).",
  fileWriteComplete: "Datei geschrieben: {path} ({bytes} Byte).",
  fileReadFailed: "Beim Lesen der Datei ist für {name} ein Fehler aufgetreten.",
  fileWriteFailed:
    "Beim Schreiben der Datei ist für {name} ein Fehler aufgetreten.",
  listFailure: "Die Dateiliste konnte nicht gelesen werden.",
  readFailure: "Die Datei konnte nicht gelesen werden.",
  writeFailure: "Die Datei konnte nicht geschrieben werden.",
  fileTruncated: "...(gekürzt)",
  computerPermissionDenied:
    "Fehler: Dieser Agent hat keine Berechtigung zur Computerbeobachtung.",
  computerDispatch: "Computerstatus wird gelesen",
  computerTitle: "COMPUTERSTATUS",
  workspaceTitle: "TERMINAL / ARBEITSBEREICH",
  browserTitle: "BROWSER",
  computerRecent: "LETZTE COMPUTERSCHRITTE (älteste → neueste)",
  computerNext:
    "Wähle anhand dieses tatsächlichen Zustands genau eine nächste Computeraktion; prüfe ihr Ergebnis, bevor du fortfährst.",
  computerObserved: "{name} hat den Computerstatus beobachtet.",
  computerObservationFailed:
    "Bei der Beobachtung des Computerstatus ist für {name} ein Fehler aufgetreten.",
  computerFailure: "Die Computerbeobachtung ist fehlgeschlagen.",
  computerError: "Beobachtungsfehler: {message}",
  emergencyBlocked:
    "BLOCKIERT: Der Notstopp wurde aktiviert oder während der Ausführung geändert; der Werkzeugvorgang wurde gestoppt.",
  operationFailure: "Der Werkzeugvorgang konnte nicht abgeschlossen werden.",
  browserPermissionDenied:
    "Fehler: Dieser Agent hat keine Browserberechtigung (canBrowse).",
  browserWorkerOnly:
    "BLOCKIERT: Der getrennte API-Prozess kann Browserwerkzeuge nicht lokal ausführen; ein Worker-Prozess muss diesen Vorgang ausführen.",
  browserUrlRequired: "Fehler: url muss eine nicht leere Zeichenfolge sein.",
  browserUrlInvalid: "Fehler: url ist ungültig.",
  browserRefRequired: "Fehler: ref muss eine positive, sichere Ganzzahl sein.",
  browserInputTextInvalid:
    "Der Browsertext darf nicht leer sein und muss gültiges Unicode ohne NUL enthalten; die Grenze beträgt 4096 UTF-16-Codeeinheiten.",
  browserTextRequired: "Fehler: text muss eine Zeichenfolge sein.",
  browserSubmitInvalid: "Fehler: submit darf nur true oder false sein.",
  browserDirectionRequired: "Fehler: direction darf nur up oder down sein.",
  browserWaitRequired: "Fehler: milliseconds muss eine endliche Zahl sein.",
  browserNameInvalid: "Fehler: name muss eine Zeichenfolge sein.",
  browserSeparateSubmit:
    "BLOCKIERT: Texteingabe und Formularversand müssen getrennt genehmigte Aktionen sein. Verwende zuerst browser_type mit submit=false; erstelle dann einen neuen snapshot und beantrage über browser_click eine separate Genehmigung für die genaue Schaltfläche zum Absenden.",
  browserTargetChanged:
    "BLOCKIERT: Das genehmigte Browserziel hat sich geändert oder ist nicht verfügbar; ein neuer snapshot und eine neue Genehmigung sind erforderlich.",
  browserFieldChanged:
    "BLOCKIERT: Das genehmigte Browserfeld hat sich geändert, ist nun sensibel oder ist nicht verfügbar; ein neuer snapshot und eine neue Genehmigung sind erforderlich.",
  browserSensitiveBlocked:
    "BLOCKIERT: Der Agent darf keine Passwörter, OTP, Kartendaten oder ähnliche sensible Identitätsfelder ausfüllen. Der Gründer muss dieses Feld selbst über Browser Workbench ausfüllen.",
  browserUnknown: "Unbekannter Fehler",
  browserOpenDispatch: "Browserseite wird geöffnet",
  browserSnapshotDispatch: "Browserseite wird beobachtet",
  browserApprovedClickDispatch: "Genehmigter Klick wird gesendet",
  browserClickDispatch: "Browserklick wird gesendet",
  browserLinkDispatch: "Sicherer Link wird geöffnet",
  browserApprovedTypeDispatch: "Genehmigter Text wird gesendet",
  browserTypeDispatch: "Browsertext wird gesendet",
  browserScrollDispatch: "Im Browser wird gescrollt",
  browserExtractDispatch: "Browsertext wird gelesen",
  browserWaitDispatch: "Im Browser wird gewartet",
  browserScreenshotDispatch: "Browsernachweis wird gespeichert",
  browserOpened: "{name} hat eine Seite im Browser geöffnet.",
  browserOpenFailed: "{name} konnte die Browserseite nicht öffnen.",
  browserObserved: "{name} hat die Browserseite beobachtet.",
  browserObserveFailed:
    "Bei der Beobachtung der Browserseite ist für {name} ein Fehler aufgetreten.",
  browserApprovedClicked: "{name} hat auf das genehmigte Seitenziel geklickt.",
  browserClicked: "Geklickt.",
  browserClickFailed:
    "Beim Browserklick ist für {name} ein Fehler aufgetreten.",
  browserClickApproval:
    "{name} wartet auf die Genehmigung für den Browserklick.",
  browserLinkOpened: "{name} hat das Ziel des sicheren Links geöffnet.",
  browserLinkFailed:
    "Beim Öffnen des sicheren Links ist für {name} ein Fehler aufgetreten.",
  browserLinkFailure: "Der sichere Link konnte nicht geöffnet werden.",
  browserApprovedTyped:
    "{name} hat Text in das genehmigte Browserfeld eingegeben.",
  browserTyped: "Text eingegeben. Die aktuelle Seitenansicht folgt unten.",
  browserSensitiveAvoided:
    "{name} hat sich sicher aus dem sensiblen Browserfeld zurückgezogen.",
  browserTypeApproval:
    "{name} wartet auf die Genehmigung zur Texteingabe im Browser.",
  browserTypeFailed:
    "Bei der Texteingabe im Browser ist für {name} ein Fehler aufgetreten.",
  browserScrolledDown: "{name} hat die Browserseite nach unten gescrollt.",
  browserScrolledUp: "{name} hat die Browserseite nach oben gescrollt.",
  browserDown: "Nach unten gescrollt.",
  browserUp: "Nach oben gescrollt.",
  browserScrollFailed:
    "Beim Scrollen im Browser ist für {name} ein Fehler aufgetreten.",
  browserExtracted:
    "{name} hat den sichtbaren Text aus dem Browser extrahiert.",
  browserExtractFailed:
    "Beim Extrahieren des Browsertexts ist für {name} ein Fehler aufgetreten.",
  browserEmptyText: "(Seitentext ist leer)",
  browserWaited: "{name} hat die dynamische Browserseite erneut beobachtet.",
  browserWaitComplete: "{milliseconds} ms gewartet.",
  browserWaitFailed:
    "Beim Warteschritt im Browser ist für {name} ein Fehler aufgetreten.",
  browserScreenshotSaved:
    "{name} hat einen Browser-Screenshot als Nachweis gespeichert.",
  browserScreenshotFailed:
    "{name} konnte das Browserbild als Nachweis nicht speichern.",
  browserPngSaved: "PNG-Nachweis gespeichert: {path}",
  browserSize: "Größe: {bytes} Byte",
  browserError: "Browserfehler: {message}",
  browserSnapshotError: "Fehler bei der Seitenbeobachtung: {message}",
  browserClickError: "Klickfehler: {message}",
  browserTypeError: "Fehler bei der Texteingabe: {message}",
  browserScrollError: "Fehler beim Scrollen: {message}",
  browserExtractError: "Fehler bei der Textextraktion: {message}",
  browserWaitError: "Fehler beim Warten: {message}",
  browserScreenshotError: "Screenshot-Fehler: {message}",
  browserPage: "SEITE: {title} · {url}",
  browserUntitled: "(ohne Titel)",
  browserReferences: "REFERENZEN INTERAKTIVER ELEMENTE:",
  browserValue: "{text} (Wert: {value})",
  browserVisibleText: "SICHTBARER TEXT (erster Abschnitt):",
  browserActionUnknown:
    "Die Browseraktion wurde gesendet, ihr Ergebnis konnte jedoch nicht bestätigt werden. Ein automatischer erneuter Versuch wurde blockiert.",
  browserLaunchFailed:
    "Der Browser konnte nicht gestartet werden ({channel}): {message}",
  browserLaunchUnavailable:
    "Der Browser konnte nicht gestartet werden ({channel}).",
  browserDisconnected:
    "Die Browsersitzung wurde während einer laufenden Aktion getrennt; die Aktion wird in einer neuen Sitzung nicht automatisch wiederholt.",
  browserSessionLimit:
    "Die maximale Anzahl an Browsersitzungen ist erreicht ({limit}). Inaktive Sitzungen werden automatisch geschlossen.",
  browserSessionMissing: "Die Browsersitzung ist nicht verfügbar.",
  browserAffinityFailure:
    "Die Browsersitzung konnte nicht sicher an die Ausführungsinstanz gebunden werden; die Sitzung wurde geschlossen.",
  browserSessionChanged:
    "Die Browsersitzung wurde geschlossen oder hat sich geändert; der Befehl wurde nicht ausgeführt.",
  browserApprovedSessionChanged:
    "Die genehmigte Browsersitzung wurde geschlossen oder hat sich geändert; eine neue Genehmigung ist erforderlich.",
  browserRefMissing:
    "ref={ref} wurde nicht gefunden. Erstelle zuerst einen browser_snapshot.",
  browserRefDetached: "ref={ref} ist auf der Seite nicht mehr sichtbar.",
  browserRefStale:
    "ref={ref} gehört zu einem alten snapshot. Erstelle einen neuen snapshot.",
  browserApprovedElementChanged:
    "Die Seite oder das Zielelement hat sich nach der Genehmigung geändert; eine neue Genehmigung ist erforderlich.",
  browserApprovedFieldChanged:
    "Die Seite oder das Zielfeld hat sich nach der Genehmigung geändert; eine neue Genehmigung ist erforderlich.",
  browserOperatorLeaseRequired:
    "Für eine Operatoraktion ist eine aktive leaseId erforderlich.",
  browserClosing:
    "Die Browsersitzung wird geschlossen; es kann keine neue Aktion gestartet werden.",
  browserRuntimeClosing:
    "Die Browser-Ausführungsinstanz wird bereits beendet oder pausiert.",
  browserQueueFull:
    "Die Browser-Eingabewarteschlange ist voll ({limit}); der Client muss langsamer senden.",
  browserOperatorOwns:
    "Der Operator hat diesen Browser übernommen; Agentenaktionen sind bis {expiresAt} nicht verfügbar.",
  browserAgentBusy:
    "Eine Browseraktion des Agenten läuft; warte, bis sie beendet ist, und versuche die Übernahme dann erneut.",
  browserOtherOperator:
    "Der Browser unterliegt der Ausführungsberechtigung eines anderen Operators.",
  browserLeaseInvalid:
    "Die Browser-Steuerungsberechtigung ist ungültig oder abgelaufen.",
  browserReleaseOwnerOnly:
    "Nur der Inhaber der aktiven Steuerungsberechtigung kann den Browser an den Agenten zurückgeben.",
  browserOperatorBusy:
    "Eine Browseraktion des Operators läuft; die Steuerung kann noch nicht freigegeben werden.",
  browserActionInFlight:
    "Die Sitzung kann während einer laufenden Browseraktion nicht geschlossen werden; warte, bis die Aktion beendet ist.",
  browserCloseOwnerOnly:
    "Ein vom Operator gesteuerter Browser kann nur mit der genauen, aktiven leaseId geschlossen werden.",
  browserTargetInvalid: "Ungültiges Browserziel.",
  browserPrivateTarget:
    "Private oder lokale Netzwerkziele wurden durch die Browser-Sicherheitsrichtlinie blockiert.",
  browserPrivateIp: "Private oder lokale IP-Ziele wurden blockiert.",
  browserUnsafeResolution:
    "Für die Zieldomain konnte keine sichere und nutzbare IP-Adresse bestätigt werden.",
  browserUnresolved: "Die Zieldomain konnte nicht aufgelöst werden.",
  browserProtocolDenied: "Nur http- und https-Adressen sind erlaubt.",
  browserCredentialsDenied:
    "Benutzernamen oder Passwörter dürfen nicht in der URL enthalten sein.",
  teamStringRequired:
    "Fehler: {field} muss eine nicht leere Zeichenfolge sein.",
  teamStringInvalid: "Fehler: {field} muss eine Zeichenfolge sein.",
  teamNumberInvalid: "Fehler: {field} muss eine gültige Zahl sein.",
  teamChoiceInvalid:
    "Fehler: {field} muss einen dieser Werte haben: {choices}.",
  teamBriefTooLong: "Fehler: brief darf höchstens 8000 Zeichen enthalten.",
  teamCadenceInvalid:
    "Fehler: autonomyMode muss finite/continuous sein; cadenceSeconds ist nur für continuous im Bereich von 60 bis 604800 zulässig.",
  teamCreateDenied:
    "Fehler: Dieser Agent hat keine Berechtigung, Unteragenten zu erstellen.",
  teamDelegateDenied:
    "Fehler: Dieser Agent hat keine Berechtigung, Aufgaben zu delegieren.",
  teamAgentCapacity:
    "BLOCKIERT: Die Kapazität für aktive Agenten ist ausgeschöpft (limit={limit}).",
  teamTaskCapacity:
    "BLOCKIERT: Die Kapazität für ausstehende Aufgaben ist ausgeschöpft (limit={limit}).",
  teamCreateStopped:
    "BLOCKIERT: Die Aufgabe wurde gestoppt; es wurde kein Unteragent erstellt.",
  teamAgentCreated: "Neuer Unteragent erstellt. agentId={id}",
  teamAgentActivity:
    '{name} hat einen neuen Unteragenten namens "{child}" ({role}) erstellt.',
  teamDelegateStopped:
    "BLOCKIERT: Der Zielagent ist inaktiv oder nicht geeignet, oder die Quellaufgabe wurde gestoppt; es wurde keine Delegation erstellt.",
  teamDelegated: "Aufgabe erstellt und delegiert. taskId={id}",
  teamTaskCreatedActivity: 'Neue Aufgabe erstellt: "{title}"',
  teamDelegatedActivity:
    '{name} hat die Aufgabe "{title}" an {target} ({role}) delegiert.',
  teamTaskContext: "Fehler: Es gibt keinen aktiven Aufgabenkontext.",
  teamProgressDefault: "Fortschritt aktualisiert.",
  teamProgressStopped:
    "BLOCKIERT: Die Aufgabe wurde gestoppt; der Fortschritt wurde nicht gespeichert.",
  teamProgressSaved: "Fortschritt gespeichert: {progress}%.",
  teamTaskLost:
    "BLOCKIERT: Die Aufgabe wurde gestoppt oder die Ausführungsberechtigung ging verloren.",
  teamChildUnresolved:
    "BLOCKIERT: Die Unteraufgabe taskId={id} hat weiterhin den Status {status}; kläre zuerst ihr Ergebnis oder brich sie ab.",
  teamCompletionRejected:
    "Die Prüfung hat diesen Abschluss abgelehnt: {reason} Bringe die Aufgabe mit der ursprünglichen Anweisung in Einklang und versuche es erneut.",
  teamCyclePrepared:
    "Dieser Arbeitszyklus wurde für den atomaren Abschluss um {at} vorbereitet.",
  teamCompletionPrepared:
    "Der Aufgabenabschluss wurde für den atomaren Abschluss vorbereitet.",
  teamCycleActivity:
    "Dieser Zyklus der fortlaufenden Aufgabe wurde abgeschlossen; die nächste Ausführung wurde geplant: {summary}",
  teamCompletionWarnActivity:
    "Aufgabe abgeschlossen (mit einer Warnung der Prüfung): {summary}",
  teamCompletionActivity: "Aufgabe abgeschlossen: {summary}",
  teamChildCompletedActivity:
    '{name} hat die Unteraufgabe abgeschlossen: "{title}" -- {summary}',
  teamCompletionStopped:
    "BLOCKIERT: Die Aufgabe wurde gestoppt; der Abschluss wurde nicht gespeichert.",
  teamCycleComplete:
    "Dieser Arbeitszyklus wurde abgeschlossen; die Aufgabe wird um {at} erneut ausgeführt.",
  teamComplete: "Die Aufgabe wurde als erfolgreich abgeschlossen markiert.",
  teamApprovalUnsupported:
    "BLOCKIERT: {tool} kann nach der Genehmigung nicht atomar ausgeführt werden; eine Genehmigung, die ein Werkzeug benennt, muss eine ausführbare Aktion enthalten.",
  teamApprovalScopeRequired:
    "BLOCKIERT: Eine auf ein Werkzeug beschränkte Genehmigung erfordert sowohl toolName als auch toolArgs.",
  teamApprovalArgsInvalid: "Fehler: toolArgs muss ein JSON-Objekt sein.",
  teamSudoDenied:
    "BLOCKIERT: Eine sudo-Genehmigung kann nur vom aktiven, berechtigten obersten CEO bei aktivierter Ausführungsfreigabe erstellt werden.",
  teamSudoInvalid: "BLOCKIERT: Ungültige sudo-Genehmigung ({reason})",
  teamSudoTitle: "KRITISCH: CEO-Befehl für die Host-Shell",
  teamSudoDescription:
    "Diese Genehmigung führt den exakten Befehl einmal auf dem angegebenen Host und im angegebenen Startverzeichnis mit den bestehenden Betriebssystemberechtigungen des API-Dienstkontos aus; sie gewährt keine Rechteerweiterung auf root/Administrator. Vom Befehl aufgerufene Skripte oder Programme können sich nach der Genehmigung ändern; gestartete Unterprozesse können über das Zeitlimit der Shell hinaus weiterlaufen.",
  teamCategoryRequired:
    "BLOCKIERT: {tool} erfordert category={category}; eine niedrigere Kategorie kann diese Aktion nicht autorisieren.",
  teamCategoryDenied:
    "BLOCKIERT: Dieser Agent hat keine Berechtigung, Aktionen mit category={category} vorzuschlagen.",
  teamBrowserApprovalContext:
    "BLOCKIERT: Eine Browsergenehmigung erfordert einen aktiven Worker-Prozess, einen aktuellen snapshot und einen numerischen ref.",
  teamBrowserApprovalMissing:
    "BLOCKIERT: Das Browserziel wurde in der aktuellen Sitzung nicht gefunden; erstelle einen neuen snapshot und schlage die Aktion erneut vor.",
  teamBrowserApprovalSensitive:
    "BLOCKIERT: Sensible Browserfelder dürfen nicht über eine Agentengenehmigung ausgefüllt werden.",
  teamSpendAmount:
    "BLOCKIERT: Eine Ausgabengenehmigung erfordert einen positiven, endlichen amountUsd.",
  teamApprovalStopped:
    "BLOCKIERT: Die Aufgabe wurde gestoppt; es wurde keine Genehmigungsanfrage erstellt.",
  teamAmount: "Betrag: ${amount}",
  teamApprovalRejected:
    "Die Prüfung hat diese Genehmigungsanfrage abgelehnt: {reason} Starte diese Aktion nicht.",
  teamSudoRevoked:
    "BLOCKIERT: Die sudo-Berechtigung wurde widerrufen, bevor der Genehmigungseintrag erstellt wurde.",
  teamSudoTargetChanged:
    "BLOCKIERT: Der sudo-Host oder der Arbeitsbereich hat sich geändert, bevor die Genehmigung erstellt wurde.",
  teamApprovalPrepared:
    "Die Genehmigungsanfrage wurde für den atomaren Abschluss vorbereitet.",
  teamApprovalActivity: "Genehmigungsanfrage: {title}",
  teamApprovalCapacity:
    "BLOCKIERT: Die Kapazität für Genehmigungen oder Aufgaben ist ausgeschöpft (limit={limit}).",
  teamApprovalCreated:
    "Genehmigungsanfrage erstellt (approvalId={id}, taskId={taskId}); die Genehmigung des Benutzers steht noch aus.",
  teamApprovalExpiry:
    " Die Genehmigung ist {minutes} Minuten lang und für eine einmalige Nutzung gültig.",
  teamReviewNote: " (Prüfhinweis: {reason})",
  teamQuestionBound:
    "Fehler: question muss sichtbaren Text enthalten und darf 1000 Zeichen nicht überschreiten. Stelle eine einzige, vollständige und kurze Frage.",
  teamQuestionPrepared:
    "Die Frage wurde für den atomaren Abschluss vorbereitet.",
  teamInputWaiting: "Benutzereingabe steht noch aus.",
  teamQuestionActivity: "Frage: {question}",
  teamQuestionStopped:
    "BLOCKIERT: Die Aufgabe wurde gestoppt; die Frage wurde nicht gespeichert.",
  teamQuestionSaved:
    "Frage gespeichert; die Antwort des Benutzers steht noch aus.",
  teamNoteSaved: "Notiz gespeichert.",
  teamMessageBound:
    "Fehler: Eine Nachricht im Unternehmenskanal darf höchstens 4000 Zeichen enthalten.",
  teamChannelName: "Unternehmensraum",
  teamChannelMissing: "Unternehmenskanal nicht gefunden.",
  teamMembershipMissing:
    "Der Agent ist kein Mitglied des Unternehmensraums oder ist inaktiv.",
  teamReplyMissing:
    "Die Nachricht im Unternehmenskanal, auf die geantwortet wird, wurde nicht gefunden.",
  teamMessageCooldown:
    "Zwischen Nachrichten desselben Agenten im Unternehmenskanal müssen mindestens 5 Sekunden liegen.",
  teamMessageCapacity:
    "BLOCKIERT: Die Kapazität für Nachrichten im Unternehmenskanal ist ausgeschöpft (limit={limit}).",
  teamBlocked: "BLOCKIERT: {reason}",
  teamMessageFailed:
    "BLOCKIERT: Die Nachricht im Unternehmenskanal konnte nicht gespeichert werden.",
  teamMessageSaved:
    "Die Nachricht im Unternehmenskanal wurde mit deiner tatsächlichen Absenderidentität gespeichert (messageId={id}).",
  previewInstance: "API-Prozessinstanz: {id}",
  previewHost: "Host: {host}",
  previewDirectory: "Startverzeichnis: {path}",
  previewCommand: "Exakter Befehl (wird unverändert ausgeführt):",
  previewWarning:
    "Warnung: Vom Befehl aufgerufene Skripte oder Programme können sich nach der Genehmigung ändern; gestartete Unterprozesse können über das Zeitlimit der Shell hinaus weiterlaufen.",
  previewPage: "Seite: {url}",
  previewUnknown: "(unbekannt)",
  previewField: "Feld: {role} · {text}",
  previewFieldDefault: "Feld",
  previewUnlabeled: "(ohne Beschriftung)",
  previewContext: "Kontext: {text}",
  previewText: "Einzugebender Text: {text}",
  previewSubmit: "Mit Enter absenden: {value}",
  previewYes: "ja",
  previewNo: "nein",
  previewElement: "Element: {role} · {text}",
  previewElementDefault: "Element",
  previewLink: "Link: {url}",
  previewForm: "Formularziel: {url}",
  judgeMissingReason: "Die Prüfung hat keine Begründung zurückgegeben.",
  judgeSudoReason:
    "Der sudo-Vorschlag wurde als {verdict} eingestuft; der exakte Befehl wird nur bei der lokalen Genehmigung durch einen Menschen angezeigt.",
  judgeReview: "Prüfung ({purpose}): {verdict}",
  judgeCompletion: "Abschluss",
  judgeApproval: "Genehmigungsanfrage",
  judgeRedacted:
    "[AUSGEBLENDET: Der exakte sudo-Befehl wird nur in der ausstehenden Genehmigung gespeichert]",
  judgeCompletionUnavailable:
    "Der Abschluss wurde sicher blockiert, weil die Prüfung nicht bestätigt werden konnte.",
  judgeApprovalUnavailable:
    "Der Prüfdienst war nicht verfügbar; diese Anfrage kann nur mit menschlicher Genehmigung fortgesetzt werden.",
  judgeUnavailable: "Prüfung nicht verfügbar: {verdict}",
  teamAgentReplayed:
    "Der Unteragent wurde bereits erstellt; er wurde nicht erneut erstellt. agentId={id}",
  teamTaskReplayed:
    "Die Delegation wurde bereits gespeichert; sie wurde nicht erneut erstellt. taskId={id}",
  teamApprovalReplayed:
    "Die Genehmigungsanfrage wurde bereits atomar gespeichert; sie wurde nicht erneut erstellt. approvalId={id}",
  teamOperationReplayed:
    "Der Vorgang wurde bereits atomar gespeichert; er wurde nicht erneut angewendet.{evidence}",
  teamEvidence: " Nachweis: {data}.",
  readReplayed:
    "Der Lesevorgang wurde bereits abgeschlossen; der Rohinhalt wurde nicht im Vorgangsbeleg gespeichert. Fordere für aktuelle Daten einen neuen Lesevorgang an.",
  readReconciled:
    "Der Operator hat diesen Lesevorgang als ausgeführt abgeglichen; er wurde nicht automatisch wiederholt und der Rohinhalt wurde nicht gespeichert.",
  readRetry:
    "Der Lesevorgang konnte nicht abgeschlossen werden; er wurde für einen sicheren erneuten Versuch freigegeben.",
  teamCreateDispatch: "Unteragent wird erstellt",
  teamDelegateDispatch: "Aufgabe wird delegiert",
  teamProgressDispatch: "Fortschritt wird gespeichert",
  teamCompleteDispatch: "Aufgabenergebnis wird geprüft",
  teamApprovalDispatch: "Zustimmung des Operators wird angefordert",
  teamQuestionDispatch: "Benutzereingabe wird angefordert",
  teamNoteDispatch: "Nachweisnotiz wird gespeichert",
  teamMessageDispatch: "Nachricht wird im gemeinsamen Kanal veröffentlicht",
  toolDispatch: "Werkzeug wird ausgeführt · {tool}",
  chatAnalyzing: "Nachricht wird analysiert",
  chatPlanning: "Antwort wird vorbereitet · Runde {round}/{total}",
  taskAnalyzing: "Aufgabe wird analysiert",
  taskPlanning: "Planung · Runde {round}/{total}",
  taskModelRunning: "Modell wird ausgeführt · {model}",
  taskOwnerMissing:
    "Der zuständige Agent fehlt oder ist inaktiv; die Aufgabe wurde als fehlgeschlagen markiert.",
  taskLeaseMismatch:
    "Die Inhaber der Ausführungsrechte für Aufgabe und Agent stimmen nicht überein.",
  modelFallback:
    "Das primäre Modell konnte diesen Schritt nicht voranbringen; die Aufgabe wird mit dem zulässigen Ersatzmodell {model} fortgesetzt.",
  modelRouteFailed:
    "Das Modell war nicht verfügbar; die Aufgabe versucht es mit dem nächsten zulässigen Modell {model}.",
  taskUnknownError: "Unbekannter Fehler im Aufgabenschritt.",
  taskBlocked:
    "Die Aufgabe wurde nach {count} aufeinanderfolgenden Laufzeitfehlern gestoppt; eine Prüfung durch den Betreiber ist erforderlich.",
  taskProviderRetry:
    "Versuche mit allen zulässigen Modellen sind fehlgeschlagen; die Aufgabe bleibt erhalten und wurde für {at} erneut eingeplant.",
  taskRuntimeRetry:
    "In diesem Schritt ist ein Laufzeitfehler aufgetreten; die Aufgabe wurde für {at} erneut eingeplant.",
  receiptLabel: "Vorgangsbeleg: {id}",
  toolUnknown: "Fehler: unbekanntes Werkzeug '{tool}'.",
  approvedToolCompleted: "Genehmigte Aktion abgeschlossen: {tool}.",
  approvedToolFailed: "Genehmigte Aktion fehlgeschlagen: {tool}.",
  exclusiveTurnInstruction:
    "Der Nutzer hat diesen Durchlauf ausdrücklich auf diese Werkzeuge beschränkt: {tools}. Überschreite diesen Rahmen auch dann nicht, wenn es für das erlaubte Ergebnis nützlich erscheint; erstelle außerhalb dieses Rahmens keine Notizen, Dateien, Aufgaben oder Unteragenten. Wenn die erlaubten Werkzeuge nicht ausreichen, melde dies, ohne den Umfang zu erweitern.",
  exclusiveSudoExactInstruction:
    "Eine sudo-Freigabe darf nur für den exakten Befehl des Nutzers angefordert werden.",
  exclusiveSudoUnavailableInstruction:
    "Der genaue sudo-Befehl konnte nicht sicher ermittelt werden. Verwende in diesem Durchlauf kein sudo-Werkzeug; melde das Hindernis, ohne den Umfang zu erweitern.",
  operationReconciled: "Der Operator hat den ungewissen Vorgang abgeglichen.",
  approvalBindingInvalidated:
    "Die genehmigte Browserbindung ist nicht mehr gültig; eine neue Genehmigung ist erforderlich.",
  judgeRunning: "Aufgabe wird geprüft",
  taskAdvanceInstruction:
    "Führe die Aufgabe einen Schritt weiter. Bewerte den aktuellen Zustand und rufe die passenden Werkzeuge auf.",
  taskOpenInstruction:
    "Die Aufgabe ist noch offen. Beende sie nicht nach einer Erklärung: Rufe das nächste sichere konkrete Werkzeug auf, nutze request_user_input, wenn menschliche Eingaben erforderlich sind, oder complete_task, wenn Belege die Abnahmekriterien erfüllen.",
  taskPassiveFallbackInstruction:
    "Das vorherige Modell hat zweimal ohne Aufruf eines Werkzeugs für den Aufgabenlebenszyklus angehalten. Behalte den Kontext bei und fahre mit einem konkreten Werkzeugschritt fort.",
  taskBatchFallbackInstruction:
    "Das vorherige Modell hat die sichere Grenze für Werkzeugaufrufe überschritten ({count}/{limit}). Behalte die Aufgabe bei, bleibe pro Runde unter dieser Grenze und fahre mit dem sichersten konkreten Schritt fort.",
  taskLifecycleFallbackInstruction:
    "Das vorherige Modell hat ein Werkzeug für den Aufgabenlebenszyklus zweimal mit ungültigen oder abgelehnten Argumenten aufgerufen. Behalte den Kontext bei, prüfe das Ergebnis und rufe das Werkzeug mit gültigen Argumenten auf.",
  taskToolRetryInstruction:
    "Alle Werkzeugaufrufe dieser Runde wurden als ungültig, nicht autorisiert oder nicht ausgeführt abgelehnt. Korrigiere Schema und Berechtigungen und führe einen weiteren konkreten, gültigen Werkzeugaufruf aus.",
  taskToolFallbackInstruction:
    "Das vorherige Modell konnte das Werkzeugprotokoll zweimal nicht verwenden. Behalte den Kontext bei und fahre mit einem konkreten Schritt fort, der genau einem zulässigen Werkzeugschema entspricht.",
  operationCompleted: "Vorgang abgeschlossen: {tool}.",
  modelFailure: "{reason} ({source})",
  failureRateLimit: "Das Anfragelimit des Modells wurde erreicht.",
  failureTimeout: "Die Modellanfrage hat das Zeitlimit überschritten.",
  failureAuthentication:
    "Der Modellanbieter hat die Authentifizierung abgelehnt.",
  failurePayment:
    "Der Modellanbieter verlangt eine Zahlung oder verfügbares Guthaben.",
  failureModelUnavailable: "Das angeforderte Modell ist nicht verfügbar.",
  failureToolCompatibility:
    "Das Modell hat mit dem erforderlichen Werkzeugprotokoll keine nutzbare Antwort erzeugt.",
  failureProviderUnavailable: "Der Modellanbieter ist nicht verfügbar.",
};
