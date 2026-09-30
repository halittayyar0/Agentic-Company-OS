export interface CsvAudit {
  rows: number;
  columns: number;
  widthErrors: number;
  duplicates: number;
  emptyHeaders: number;
  duplicateHeaders: number;
  missing: number[];
  headers: string[];
}

export interface JsonAudit {
  rootType: string;
  keys: string[];
  types: Record<string, number>;
  nodes: number;
  maxDepth: number;
}

export interface ListComparison {
  onlyA: string[];
  onlyB: string[];
  common: string[];
  countA: number;
  countB: number;
}

export function auditCsv(input: string): CsvAudit;
export function auditJson(input: string): JsonAudit;
export function compareLists(first: string, second: string): ListComparison;
export const quickToolTranslations: Record<string, Record<string, string>>;
export const quickToolExamples: {
  csv: string;
  json: string;
  lists: [string, string];
};
export type QuickToolMode = "csv" | "json" | "lists";
export function formatQuickReport(
  mode: "csv",
  result: CsvAudit,
  locale?: string,
): { summary: string; report: string };
export function formatQuickReport(
  mode: "json",
  result: JsonAudit,
  locale?: string,
): { summary: string; report: string };
export function formatQuickReport(
  mode: "lists",
  result: ListComparison,
  locale?: string,
): { summary: string; report: string };
