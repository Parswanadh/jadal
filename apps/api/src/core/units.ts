/**
 * Unit conversions. Single source of truth so no caller re-derives them.
 *
 * 1 mm over 1 ha = 10 m³  (0.001 m × 10 000 m²)
 */

/** 1 mm over 1 ha equals 10 m³. */
export const M3_PER_MM_HA = 10;

/** Depth in mm over an area in ha → volume in m³. */
export function mmHaToM3(depth_mm: number, area_ha: number): number {
  if (depth_mm < 0 || area_ha < 0) {
    throw new RangeError("depth_mm and area_ha must be non-negative");
  }
  return depth_mm * area_ha * M3_PER_MM_HA;
}

/** Volume in m³ over an area in ha → depth in mm. */
export function m3ToMm(volume_m3: number, area_ha: number): number {
  if (area_ha <= 0) throw new RangeError("area_ha must be positive");
  return volume_m3 / (area_ha * M3_PER_MM_HA);
}

/** Seconds → hours. */
export function secondsToHours(seconds: number): number {
  return seconds / 3600;
}

/** Hours → seconds. */
export function hoursToSeconds(hours: number): number {
  return hours * 3600;
}

/** Round to `digits` decimals, avoiding -0 and float dust like 0.30000000000000004. */
export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}