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
