/**
 * Provenance checking for the shipped `crop-params.json`.
 *
 * This module is the single source of truth shared by two callers:
 *  * `packages/core/src/data/crop-params.provenance.test.ts` — the vitest that fails when a field
 *    lacks a `constant_status` tag or a MEASURED field cites a page outside the source document.
 *  * `packages/core/scripts/generate-crop-params-provenance.ts` — the rerunnable generator that
 *    writes `docs/research/crop-params-provenance.md`.
 *
 * It does NO water arithmetic and changes no value. It only classifies provenance metadata that is
 * already in the JSON file.
 *
 * SOURCE for the page ceiling (401): `docs/research/model-audit.md` §8.2 — the unabridged FAO-56
 * Rev.1 (2025) text ends at printed p. 401 (Selected Bibliography). A `p. 410` citation therefore
 * points at a page that does not exist. MAX_SOURCED_PAGE is READ from that audit, not computed.
 */

/** Statuses a `constant_status` entry may take. */
export const CONSTANT_STATUSES = ['MEASURED', 'ASSUMED', 'UNSOURCED'] as const;
export type ConstantStatus = (typeof CONSTANT_STATUSES)[number];

/** Last printed page of FAO-56 Rev.1 (2025). READ: docs/research/model-audit.md §8.2. */
export const MAX_SOURCED_PAGE = 401;

/** Keys that describe the row rather than an agronomic constant. They need no tag. */
export const META_FIELDS = new Set(['crop', 'variant', 'source', 'constant_status']);

/**
 * Maps an agronomic field to the label prefix of the `source` clause that documents it. The
 * `source` string is a `||`-separated list of `LABEL: text` clauses (see §8.3 of the audit).
 */
export const FIELD_SOURCE_CLAUSE: Readonly<Record<string, string>> = {
  kc_ini: 'KC',
  kc_mid: 'KC',
  kc_end: 'KC',
  max_height_m: 'KC',
  root_depth_m: 'KC',
  stage_days: 'STAGE_DAYS',
  stage_gdd: 'STAGE_GDD',
  t_base_c: 'STAGE_GDD',
  t_upper_c: 'STAGE_GDD',
  depletion_p: 'DEPLETION_P',
  percolation_mm_day: 'PERCOLATION',
};

/** A crop-params row as it appears in JSON (untrusted, so every access is guarded). */
export interface CropParamsJsonRow {
  crop: string;
  variant?: string;
  source?: string;
  constant_status?: Record<string, string>;
  [field: string]: unknown;
}

export interface SourceClause {
  /** Text before the first ":" in the clause, e.g. `KC` or `STAGE_GDD/T_BASE/T_UPPER`. */
  label: string;
  /** The full trimmed clause text. */
  text: string;
}

/** Splits a `source` string into its `||`-separated clauses. */
export function splitSourceClauses(source: string): SourceClause[] {
  return source.split('||').map((raw) => {
    const text = raw.trim();
    const idx = text.indexOf(':');
    const label = idx > 0 ? text.slice(0, idx).trim() : text;
    return { label, text };
  });
}

/** Finds the source clause documenting `field`, or null when the label is unknown. */
export function clauseForField(
  record: CropParamsJsonRow,
  field: string,
): SourceClause | null {
  const prefix = FIELD_SOURCE_CLAUSE[field];
  if (prefix === undefined) return null;
  const source = typeof record.source === 'string' ? record.source : '';
  return splitSourceClauses(source).find((c) => c.label.startsWith(prefix)) ?? null;
}

const PAGE_REFERENCE = /\bp{1,2}\.\s*(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?/gi;

/**
 * Extracts the printed page numbers cited in `text`. Handles `p. 170`, `pp. 168-170`. PDF page
 * offsets (`[pdf 207]`) are deliberately NOT matched: they are not printed page numbers.
 */
export function pagesIn(text: string): number[] {
  const pages: number[] = [];
  for (const match of text.matchAll(PAGE_REFERENCE)) {
    const first = match[1];
    if (first === undefined) continue;
    pages.push(Number(first));
    const last = match[2];
    if (last !== undefined) pages.push(Number(last));
  }
  return pages;
}

/** One field's derived provenance, independent of any value-level judgement. */
export interface FieldProvenance {
  crop: string;
  variant?: string;
  field: string;
  value: unknown;
  status: string | undefined;
  sourceClause: string | null;
  pages: number[];
  /** One-line machine verdict for the markdown table. */
  finding: string;
  /** Non-null when the row violates a provenance rule. */
  violation: string | null;
}

/** Every key in a row that is an agronomic field and therefore must be tagged. */
export function dataFields(record: CropParamsJsonRow): string[] {
  return Object.keys(record).filter((key) => !META_FIELDS.has(key));
}

function asStatus(value: string | undefined): ConstantStatus | undefined {
  return value !== undefined && (CONSTANT_STATUSES as readonly string[]).includes(value)
    ? (value as ConstantStatus)
    : undefined;
}

/**
 * Derives the provenance of every agronomic field in one row. A `violation` is set when the field
 * has no tag, an unknown tag, or is MEASURED but cites no page / a page outside 1..401.
 */
export function provenanceRows(record: CropParamsJsonRow): FieldProvenance[] {
  const tags = record.constant_status ?? {};
  return dataFields(record).map((field) => {
    const rawStatus = tags[field];
    const status = asStatus(rawStatus);
    const clause = clauseForField(record, field);
    // When no labelled clause documents the field (e.g. the UNSOURCED redgram row, whose whole
    // `source` is one explanation rather than KC/STAGE_*/DEPLETION_P clauses), fall back to the
    // row-level source string so the table still shows the evidence that was actually written.
    const rowSource = typeof record.source === 'string' ? record.source.trim() : '';
    const sourceClause = clause ? clause.text : rowSource !== '' ? rowSource : null;
    const pages = clause ? pagesIn(clause.text) : [];
    const base = {
      crop: record.crop,
      variant: record.variant,
      field,
      value: record[field],
      status: rawStatus,
      sourceClause,
      pages,
    };

    let violation: string | null = null;
    let finding: string;
    if (rawStatus === undefined) {
      violation = 'missing constant_status tag';
      finding = `VIOLATION — ${violation}`;
    } else if (status === undefined) {
      violation = `invalid status "${rawStatus}"`;
      finding = `VIOLATION — ${violation}`;
    } else if (status === 'MEASURED') {
      if (!clause) {
        violation = 'MEASURED but no source clause names this field';
      } else if (pages.length === 0) {
        violation = 'MEASURED but the source clause cites no page';
      } else {
        const outside = pages.filter((p) => p < 1 || p > MAX_SOURCED_PAGE);
        if (outside.length > 0) {
          violation = `MEASURED but cites page(s) ${outside.join(', ')} outside 1..${MAX_SOURCED_PAGE}`;
        }
      }
      finding = violation ?? `sourced p. ${pages.join(', ')} (within 1..${MAX_SOURCED_PAGE})`;
    } else if (status === 'ASSUMED') {
      finding = 'assumed — not traceable to a tabulated FAO-56 value';
    } else {
      finding = 'unsourced — no valid FAO-56 citation exists for this field';
    }

    return { ...base, finding, violation };
  });
}

/** Flat list of every provenance violation across the shipped rows. */
export function checkAll(records: CropParamsJsonRow[]): string[] {
  return records.flatMap((record) =>
    provenanceRows(record)
      .filter((row) => row.violation !== null)
      .map(
        (row) =>
          `${row.crop}${row.variant ? ` (${row.variant})` : ''}.${row.field}: ${row.violation}`,
      ),
  );
}
