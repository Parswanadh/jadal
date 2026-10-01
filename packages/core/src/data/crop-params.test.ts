import { describe, it, expect } from 'vitest';
import { CropParams, CropName } from '../../../contracts/dist/index.js';
import rawData from './crop-params.json';

describe('crop-params.json validation (Task A1)', () => {
  it('loads valid array of crop parameters', () => {
    expect(Array.isArray(rawData)).toBe(true);
    expect(rawData.length).toBeGreaterThan(0);
  });

  it('validates every entry against CropParams Zod schema', () => {
    for (const entry of rawData as unknown[]) {
      const parsed = CropParams.safeParse(entry);
      expect(parsed.success, `Failed to parse entry: ${JSON.stringify(entry)}`).toBe(true);
    }
  });

  it('contains every CropName defined in the contracts', () => {
    const cropsInFile = new Set((rawData as Array<{ crop: string }>).map((c) => c.crop));
    for (const crop of CropName.options) {
      expect(cropsInFile.has(crop), `Missing crop in crop-params.json: ${crop}`).toBe(true);
    }
  });

  it('contains both flooded and intermittent variants for rice', () => {
    const riceEntries = (rawData as Array<{ crop: string; variant?: string }>).filter(
      (c) => c.crop === 'rice',
    );
    const variants = riceEntries.map((r) => r.variant);
    expect(variants).toContain('flooded');
    expect(variants).toContain('intermittent');
  });

  it('has stage lengths > 0 for all stages of all crops', () => {
    for (const entry of rawData as Array<{
      crop: string;
      variant?: string;
      stage_days: { ini: number; dev: number; mid: number; late: number };
    }>) {
      const label = `${entry.crop}${entry.variant ? ` (${entry.variant})` : ''}`;
      expect(entry.stage_days.ini, `${label} stage_days.ini must be > 0`).toBeGreaterThan(0);
      expect(entry.stage_days.dev, `${label} stage_days.dev must be > 0`).toBeGreaterThan(0);
      expect(entry.stage_days.mid, `${label} stage_days.mid must be > 0`).toBeGreaterThan(0);
      expect(entry.stage_days.late, `${label} stage_days.late must be > 0`).toBeGreaterThan(0);
    }
  });

  it('cites official FAO-56 source in the source field for every entry', () => {
    for (const entry of rawData as Array<{ crop: string; variant?: string; source: string }>) {
      const label = `${entry.crop}${entry.variant ? ` (${entry.variant})` : ''}`;
      expect(typeof entry.source, `${label} source must be a non-empty string`).toBe('string');
      expect(entry.source.length, `${label} source must not be empty`).toBeGreaterThan(10);
      expect(
        entry.source.includes('FAO-56') || entry.source.includes('fao56'),
        `${label} source must cite FAO-56`,
      ).toBe(true);
    }
  });

  it('enforces physical sanity bounds on all agronomic parameters', () => {
    for (const entry of rawData as Array<{
      crop: string;
      kc_ini: number;
      kc_mid: number;
      kc_end: number;
      max_height_m: number;
      root_depth_m: { min: number; max: number };
      depletion_p: number;
      percolation_mm_day?: number;
    }>) {
      expect(entry.kc_ini).toBeGreaterThan(0);
      expect(entry.kc_mid).toBeGreaterThan(0);
      expect(entry.kc_end).toBeGreaterThan(0);
      expect(entry.max_height_m).toBeGreaterThan(0);
      expect(entry.root_depth_m.min).toBeGreaterThan(0);
      expect(entry.root_depth_m.max).toBeGreaterThanOrEqual(entry.root_depth_m.min);
      expect(entry.depletion_p).toBeGreaterThan(0);
      expect(entry.depletion_p).toBeLessThan(1);
      if (entry.crop === 'rice') {
        expect(entry.percolation_mm_day).toBeDefined();
        expect(entry.percolation_mm_day).toBeGreaterThan(0);
      }
    }
  });
});
