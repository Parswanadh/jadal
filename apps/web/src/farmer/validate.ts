/**
 * Registration form validation. Checks shape only (required fields,
 * area-share split adds up to at most 100%). No water arithmetic here.
 */

export type CropRowInput = {
  crop: string;
  sowing_date: string;
  area_share_pct: number;
};

export type RegistrationFormInput = {
  name: string;
  phone: string;
  outlet_id: string;
  plot_area_ha: number;
  crops: CropRowInput[];
};

const SHARE_TOTAL_MAX = 100;

export function validateRegistration(input: RegistrationFormInput, todayIso: string): string[] {
  const errors: string[] = [];
  if (input.name.trim().length === 0) errors.push("register.errName");
  const digits = input.phone.replace(/\D/g, "");
  if (digits.length < 10) errors.push("register.errPhone");
  if (input.outlet_id.length === 0) errors.push("register.errOutlet");
  if (!(input.plot_area_ha > 0)) errors.push("register.errArea");

  let total = 0;
  for (const row of input.crops) {
    if (row.crop.length === 0) errors.push("register.errCrop");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.sowing_date) || row.sowing_date > todayIso) {
      errors.push("register.errSowing");
    }
    if (!(row.area_share_pct >= 1 && row.area_share_pct <= 100)) {
      errors.push("register.errShare");
    } else {
      total += row.area_share_pct;
    }
  }
  if (total > SHARE_TOTAL_MAX) errors.push("register.errShareSum");
  return [...new Set(errors)];
}

export function validateRequest(volume_m3: number, reason: string): string[] {
  const errors: string[] = [];
  if (!(volume_m3 > 0)) errors.push("urgent.errVolume");
  if (reason.trim().length === 0) errors.push("urgent.errReason");
  return errors;
}
