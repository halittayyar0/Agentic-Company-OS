import type { AuthCopy } from "../auth-copy";

const copy = {
  badge: "Sichere Anmeldung",
  title: "AgenticOS öffnen",
  description:
    "Diese Installation ist durch einen Zugangsschlüssel geschützt. Er dient ausschließlich zum Aufbau einer sicheren Sitzung.",
  accessKey: "Zugangsschlüssel",
  invalidSession:
    "Sitzung konnte nicht bestätigt werden. Bitte erneut versuchen.",
  loginFailed: "Anmeldung fehlgeschlagen.",
  verifying: "Wird überprüft…",
  signIn: "Sicher anmelden",
  checkingSession: "Sichere Sitzung wird überprüft…",
  serviceUnavailable: "Sitzungsdienst nicht erreichbar",
  serviceUnavailableDescription:
    "Der Arbeitsbereich bleibt geschlossen, bis der Sicherheitsstatus bestätigt ist.",
  retry: "Erneut versuchen",
  invalidKey: "Ungültiger Zugangsschlüssel.",
} satisfies AuthCopy;

export default copy;
