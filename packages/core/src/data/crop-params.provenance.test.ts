/**
 * Provenance conformance for the SHIPPED `crop-params.json` (handoff §5 P6).
 *
 * This file deliberately reads `./crop-params.json` rather than a hand-typed fixture, so it fails
 * when the shipped table drifts. It pins three things:
 *  1. every agronomic field carries a `constant_status` tag of MEASURED / ASSUMED / UNSOURCED;
 *  2. a MEASURED field cites a printed page inside the document (1..401) — never `p. 410` of a
 *     401-page book, and never nothing at all;
 *  3. the `redgram` row, whose FAO-56 source does not exist, is tagged UNSOURCED with its numeric
 *     values retained and the invalid `p. 410` citation recorded rather than erased.
 *
 * The checking logic lives in `./crop-params-provenance.ts` so the same rules generate
 * `docs/research/crop-params-provenance.md`. See `docs/research/model-audit.md` §8 for the audit.
 */

import { describe, expect, it } from 'vitest';

import rawData from './crop-params.json';
import {
  checkAll,
  CONSTANT_STATUSES,
  dataFields,
  MAX_SOURCED_PAGE,
  pagesIn,
  provenanceRows,
  type CropParamsJsonRow,
} from './crop-params-provenance';

const rows = rawData as unknown as CropParamsJsonRow[];
const label = (row: CropParamsJsonRow) =>
  `${row.crop}${row.variant ? ` (${row.variant})` : ''}`;

describe('crop-params.json constant_status provenance', () => {
  it('loads the shipped table', () => {
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(11);
  });

  it('every agronomic field carries a valid constant_status tag', () => {
    const missing: string[] = [];
    const invalid: string[] = [];
    for (const row of rows) {
      const tags = row.constant_status ?? {};
      for (const field of dataFields(row)) {
        const tag = tags[field];
        if (tag === undefined) missing.push(`${label(row)}.${field}`);
        else if (!(CONSTANT_STATUSES as readonly string[]).includes(tag)) {
          invalid.push(`${label(row)}.${field}=${tag}`);
        }
      }
    }
    expect(missing, `fields with no constant_status tag: ${missing.join(', ')}`).toEqual([]);
    expect(invalid, `fields with an unknown status: ${invalid.join(', ')}`).toEqual([]);
  });

  it('no MEASURED field cites a page outside 1..401 (or cites no page at all)', () => {
    const violations = checkAll(rows);
    expect(violations, `provenance violations:\n${violations.join('\n')}`).toEqual([]);
  });

  it('the check is not vacuous: a synthetic p. 410 MEASURED row IS flagged', () => {
    // Guards against the earlier bug where a test passed because it only looked for the string
    // "FAO-56" — which an invalid `p. 410` citation satisfies (audit §8.3).
    const synthetic: CropParamsJsonRow = {
      crop: 'synthetic',
      kc_ini: 1,
      source: 'KC: FAO-56 (2025) book reference (p. 410)',
      constant_status: { kc_ini: 'MEASURED' },
    };
    const violations = provenanceRows(synthetic)
      .map((r) => r.violation)
      .filter((v): v is string => v !== null);
    expect(violations.some((v) => /410/.test(v) && /1\.\.401/.test(v))).toBe(true);
  });

  it('the check is not vacuous: an untagged synthetic field IS flagged', () => {
    const synthetic: CropParamsJsonRow = {
      crop: 'synthetic',
      kc_ini: 1,
      source: 'KC: FAO-56 (2025) p. 170',
      constant_status: {},
    };
    expect(checkAll([synthetic])).toHaveLength(1);
    expect(checkAll([synthetic])[0]).toContain('missing constant_status tag');
  });

  it('parses both single pages and page ranges', () => {
    expect(pagesIn('FAO-56 Table 6.2 (p. 168-170)')).toEqual([168, 170]);
    expect(pagesIn('Table 8.2 (p. 260)')).toEqual([260]);
    // A PDF offset is not a printed page and must not be mistaken for one.
    expect(pagesIn('(p. 169) [pdf 207]')).toEqual([169]);
  });
});

describe('redgram row provenance (handoff P6 / audit F-15)', () => {
  const redgram = rows.find((row) => row.crop === 'redgram');

  it('still ships the row with every numeric value unchanged', () => {
    expect(redgram, 'redgram row must not be deleted').toBeDefined();
    expect(redgram!.kc_ini).toBe(0.35);
    expect(redgram!.kc_mid).toBe(1.1);
    expect(redgram!.kc_end).toBe(0.4);
    expect(redgram!.stage_days).toEqual({ ini: 25, dev: 35, mid: 70, late: 40 });
    expect(redgram!.max_height_m).toBe(1.8);
    expect(redgram!.root_depth_m).toEqual({ min: 1.0, max: 1.5 });
    expect(redgram!.depletion_p).toBe(0.6);
  });

  it('tags every redgram field UNSOURCED, not MEASURED', () => {
    for (const [field, status] of Object.entries(redgram!.constant_status ?? {})) {
      expect(status, `redgram.${field} must not claim to be MEASURED`).not.toBe('MEASURED');
      expect(status, `redgram.${field} must be UNSOURCED`).toBe('UNSOURCED');
    }
  });

  it('records the invalid p. 410 citation honestly, including the 401 page ceiling', () => {
    expect(redgram!.source).toMatch(/UNSOURCED/);
    expect(redgram!.source).toMatch(/p\. 410/);
    expect(redgram!.source).toMatch(/p\. 401/);
    // The old "cites official FAO-56 source" test requires this substring; keep it true.
    expect(redgram!.source).toMatch(/FAO-56/);
  });

  it('the page ceiling used by the check matches the document end', () => {
    expect(MAX_SOURCED_PAGE).toBe(401);
  });
});
