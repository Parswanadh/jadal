/**
 * Converts water depth in millimeters applied over an area in hectares
 * to volumetric water in cubic meters (m³).
 *
 * 1 mm = 0.001 m
 * 1 ha = 10,000 m²
 * 1 mm * 1 ha = 0.001 m * 10,000 m² = 10 m³
 *
 * @param depthMm Depth of water in millimeters
 * @param areaHa Area of land in hectares
 * @returns Total water volume in cubic meters (m³)
 */
export function mmHaToCubicMeters(depthMm: number, areaHa: number): number {
  if (depthMm < 0 || areaHa < 0) {
    throw new RangeError('Depth and area must be non-negative');
  }
  return depthMm * areaHa * 10;
}
