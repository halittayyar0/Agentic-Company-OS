import type { ResultFormatCopy } from "../task-result-format-copy";
export default {
  title: "Ergebnisformat",
  plain: "Freitext",
  table: "Tabelle",
  columns: "Spaltenüberschriften",
  help: "Optional. Vor Abschluss jedes Durchlaufs muss das Ergebnis diese Spalten in dieser Reihenfolge enthalten. Geprüft wird die Struktur, nicht die sachliche Richtigkeit. Es werden keine Berechtigungen erteilt.",
  add: "Spalte hinzufügen",
  remove: "Spalte entfernen",
  invalid:
    "Verwenden Sie 2–8 unterschiedliche Überschriften mit je 1–80 Zeichen, ohne äußere Leerzeichen oder Steuerzeichen.",
  saved: "Gespeichertes Ergebnisformat",
  defaults: ["Verantwortlich", "Aufgabe", "Datum"],
} satisfies ResultFormatCopy;
