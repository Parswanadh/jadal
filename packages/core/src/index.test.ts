import { describe, expect, it } from 'vitest';
import { mmHaToCubicMeters } from './index';

describe('hydraulics and unit conversions', () => {
  it('converts 1 mm over 1 ha to 10 m3', () => {
    expect(mmHaToCubicMeters(1, 1)).toBe(10);
  });

  it('converts 50 mm over 2.5 ha to 1250 m3', () => {
    expect(mmHaToCubicMeters(50, 2.5)).toBe(1250);
  });

  it('handles 0 mm or 0 ha correctly', () => {
    expect(mmHaToCubicMeters(0, 5)).toBe(0);
    expect(mmHaToCubicMeters(10, 0)).toBe(0);
  });

  it('throws on negative input', () => {
    expect(() => mmHaToCubicMeters(-1, 1)).toThrow(RangeError);
    expect(() => mmHaToCubicMeters(1, -1)).toThrow(RangeError);
  });
});
