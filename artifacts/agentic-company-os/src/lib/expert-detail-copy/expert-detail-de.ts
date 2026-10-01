import type { ExpertDetailCopy } from "../expert-detail-copy";
const copy: ExpertDetailCopy = {
  keeper: {
    title: "Gemeinsam, Schritt für Schritt.",
    talk: "Lass uns sprechen",
    idle: "Sag mir, wo du anfangen möchtest. Wir können die Aufgabe in überschaubare Schritte aufteilen.",
    working:
      "Der letzte Datensatz zeigt laufende Arbeit. Wir können den nächsten Schritt besprechen.",
    blocked:
      "Der letzte Datensatz zeigt einen blockierten Schritt. Klären wir gemeinsam, was gebraucht wird.",
    archived:
      "Dieser Experte ist archiviert. Stelle ihn bei Bedarf in den Einstellungen wieder her.",
    unknown:
      "Der aktuelle Zustand konnte nicht bestätigt werden. Aktualisiere den Datensatz, bevor du dich darauf verlässt.",
    ai: "KI-Experte · Nachrichten werden erst beim Senden übermittelt.",
  },
  managedPrompt:
    "Diese verwaltete Rolle folgt der Sprache des Arbeitsbereichs. Durch Bearbeiten und Speichern entstehen eigene Anweisungen; spätere Sprachänderungen behalten Ihren Text bei.",
  promptRequired: "Gib vor dem Speichern Arbeitsanweisungen ein.",
  invalid: "Ungültige Expertenadresse",
  missing: "Experte nicht gefunden",
  loadError: "Experte konnte nicht geladen werden",
  loadHelp:
    "Der Eintrag ist nicht verfügbar oder existiert nicht mehr. Öffne das Verzeichnis oder versuche es erneut.",
  loading: "Experte wird geladen…",
  refresh: "Eintrag aktualisieren",
  stale:
    "Der zuletzt geladene Eintrag wird angezeigt. Vor Änderungen erfolgreich aktualisieren.",
  created: "Erstellt",
  lastSeen: "Zuletzt gemeldete Aktivität",
  noSignal: "Keine Meldung",
  noStep: "Kein aktueller Schritt gemeldet",
  nextModel: "Gespeichertes Arbeitsmodell",
  changeModel: "Modell ändern",
  modelHelp:
    "Die Wahl gilt, wenn der nächste Durchlauf sein Modell auswählt. Eine laufende Anfrage wird nicht umgestellt; Anbieterzugriff ist nicht garantiert.",
  save: "Änderungen speichern",
  saving: "Wird gespeichert…",
  saved: "Der Server hat die Änderung bestätigt.",
  unknown:
    "Das Ergebnis ist unbestätigt; die Änderung kann gespeichert sein. Vor erneutem Senden aktualisieren und prüfen.",
  changed:
    "Die Expertenkonfiguration wurde anderswo geändert. Vor dem Speichern die aktuellen Werte laden und prüfen.",
  busyError:
    "Berechtigungen können während eines laufenden Durchlaufs nicht geändert werden. Warte auf dessen Ende und aktualisiere danach.",
  capacity:
    "Die Grenze aktiver Experten ist erreicht. Prüfe das Team vor der Wiederherstellung.",
  denied:
    "Der Server hat die Änderung abgelehnt. Aktualisiere und prüfe Berechtigungen und Modellwahl.",
  review: "Aktuelle Werte prüfen",
  discard: "Gespeicherte Anweisung verwenden",
  source: "Unveränderter gespeicherter Inhalt",
  promptHelp:
    "Anweisungen lenken das Verhalten, erteilen aber keine Werkzeugrechte. Der Entwurf bleibt hier, bis du speicherst oder die Seite verlässt.",
  promptChanged:
    "Die gespeicherte Anweisung wurde während deiner Bearbeitung geändert. Dein Entwurf bleibt erhalten. Vergleiche ihn vor dem Speichern mit dem Serverstand.",
  permissionsHelp:
    "Dies sind gespeicherte Berechtigungen. Laufzeitrichtlinien und erforderliche menschliche Freigaben gelten weiterhin. Während eines beanspruchten Durchlaufs sind Änderungen gesperrt.",
  enabled: "Aktiviert",
  disabled: "Deaktiviert",
  hostShell: "Host-Shell des Haupt-CEO",
  hostHelp:
    "Ein Host-Befehl benötigt weiterhin eine exakte, einmalige menschliche Freigabe und die entsprechende Servereinstellung. Er läuft mit den bestehenden OS-Rechten des Dienstkontos, ohne Sandbox oder Rechteerweiterung.",
  archive: "Experten archivieren",
  archiveTitle: "Diesen Experten archivieren?",
  archiveHelp:
    "Der Experte verlässt das aktive Team; offene Arbeit wird blockiert und ungenutzte Freigaberechte für diese Arbeit werden widerrufen. Einträge bleiben erhalten. Ein bereits laufender freigegebener Vorgang verhindert die Archivierung, bis sein Ergebnis gespeichert ist.",
  restore: "Experten wiederherstellen",
  restoreHelp:
    "Die Wiederherstellung nimmt den Experten ins aktive Team auf. Zuvor blockierte Aufgaben werden nicht automatisch fortgesetzt.",
  cancel: "Abbrechen",
  active: "Im aktiven Team",
  archived: "Archiviert",
  chat: "Chat",
  computer: "Computer",
  tasks: "Aufgaben",
  stats: "Statistik",
  settings: "Einstellungen",
  taskLoading: "Zugewiesene Aufgaben werden geladen…",
  taskError: "Zugewiesene Aufgaben konnten nicht geladen werden.",
  taskEmpty: "Diesem Experten sind keine Aufgaben zugewiesen.",
  taskWindow:
    "Bis zu 200 zuletzt zugewiesene Aufgaben werden angezeigt. Ältere Einträge können vorhanden sein.",
  progress: "Fortschritt",
  low: "Niedrig",
  normal: "Normal",
  high: "Hoch",
  urgent: "Dringend",
  statsWindow:
    "Die Stichprobe enthält höchstens die letzten 200 Aktivitätsereignisse und 200 Nachrichten. Das sind keine Gesamtsummen, Erfolgszahlen oder Kostenaufzeichnungen.",
  statsError:
    "Statistikquellen sind nicht verfügbar. Fehlende Daten werden nicht als null gewertet.",
  replies: "Agentenantworten in der Stichprobe",
  toolEvents: "Terminal- und Dateiereignisse",
  createdTasks: "Aufgabenerstellungen",
  delegations: "Delegationsereignisse",
  reviews: "Prüfereignisse",
  approvalRequests: "Freigabeanfragen",
  modelUsage: "Erfasste Modelle",
  modelUsageHelp:
    "Die fünf häufigsten erfassten Modelle; jeder Balken zeigt den Anteil an den Agentenantworten der Stichprobe.",
  noModels: "In diesen Antworten wurden keine Modellkennungen erfasst.",
  recentTools: "Letzte Terminal- und Dateiereignisse",
  noTools: "Keine Terminal- oder Dateiereignisse in dieser Stichprobe.",
  oldest: "Ältestes erfasstes Ereignis",
  records: "Erfasste Aktivitätsereignisse",
  avatar: "Porträt",
  avatarBuiltin: "Integriertes Maskottchen",
  avatarCustom: "Eigenes Bild",
  avatarHelp:
    "PNG, JPEG oder WebP bis 5 MB. Der Browser schneidet und komprimiert lokal und speichert eine Kopie bis 64 KB auf deinem Server. Die Originaldatei wird nicht an einen Bilderdienst gesendet.",
  chooseImage: "Bild wählen",
  processing: "Wird vorbereitet…",
  preview: "Ungespeicherte Vorschau",
  resetAvatar: "Integriertes Maskottchen verwenden",
  saveAvatar: "Porträt speichern",
  avatarFileError:
    "Wähle eine nicht leere PNG-, JPEG- oder WebP-Datei bis 5 MB.",
  avatarPrepareError:
    "Das Bild konnte nicht vorbereitet werden. Versuche ein kleineres gültiges Bild; maximal 40 Megapixel.",
  avatarChanged:
    "Das gespeicherte Porträt wurde geändert. Deine Vorschau bleibt erhalten; vor dem Speichern aktualisieren und prüfen.",
  configuration: "Gespeicherte Konfiguration",
  configHelp:
    "Rollenanweisungen beschreiben die Absicht. Berechtigungen, Serverrichtlinien und Freigaben regeln den Zugriff. Diese Ansicht misst weder Laufzeitzustand noch Host-Isolation.",
  serverPrompt: "Aktuell gespeicherte Anweisung ansehen",
  busyArchive:
    "Ein freigegebener Vorgang läuft. Warte vor der Archivierung auf sein gespeichertes Ergebnis.",
  readonly:
    "Der Server hat keine Konfigurationsversion geliefert. Vor der Bearbeitung aktualisieren.",
  actionTitle: "Berechtigung",
  taskMore: "Alle Projekte öffnen",
};
export default copy;
