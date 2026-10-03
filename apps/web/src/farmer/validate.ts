/**
 * Client-side form validation, expressed as zod schemas.
 *
 * Shape only: required fields, a plausible phone number, a sowing date that is not in the future,
 * and area shares that add up to at most 100%. No water arithmetic here. The schemas' issue messages
 * are i18n keys (e.g. `register.errName`), so callers render them with the same `t(...)` lookup the
 * rest of the portal uses. These are a fast, local mirror of the server's contract checks — the API
 * remains the authority.
 */

import { z } from "zod";
import { CropName } from "@jadal/contracts";

export type CropRowInput = {
  crop: string;
  sowing_date: string;
  area_share_pct: number;
};

export type RegistrationFormInput = {
  name: string;
  phone: string;
  outlet_id: string;
  soil: string;
  plot_area_ha: number;
  crops: CropRowInput[];
};

const SHARE_TOTAL_MAX = 100;

const cropRowSchema = z.object({
  crop: z.string().refine((value) => CropName.safeParse(value).success, { message: "register.errCrop" }),
  sowing_date: z
    .string()
    .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), { message: "register.errSowing" }),
  area_share_pct: z
    .number()
    .refine((value) => Number.isFinite(value) && value >= 1 && value <= 100, { message: "register.errShare" }),
});

/**
 * The registration schema. `todayIso` is captured so "not in the future" is a pure, testable check
 * rather than a hidden `new Date()` inside the schema.
 */
export function registrationSchema(todayIso: string) {
  return z
    .object({
      name: z.string().refine((value) => value.trim().length > 0, { message: "register.errName" }),
      phone: z
        .string()
        .refine((value) => value.replace(/\D/g, "").length >= 10, { message: "register.errPhone" }),
      outlet_id: z.string().min(1, { message: "register.errOutlet" }),
      soil: z.string().min(1, { message: "register.errSoil" }),
      plot_area_ha: z
        .number()
        .refine((value) => Number.isFinite(value) && value > 0, { message: "register.errArea" }),
      crops: z.array(cropRowSchema),
    })
    .superRefine((input, ctx) => {
      for (const row of input.crops) {
        if (row.sowing_date > todayIso) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["crops"], message: "register.errSowing" });
        }
      }
      // Only shares that are individually valid count towards the total, matching the per-row error.
      const total = input.crops.reduce(
        (sum, row) => sum + (row.area_share_pct >= 1 && row.area_share_pct <= 100 ? row.area_share_pct : 0),
        0,
      );
      if (total > SHARE_TOTAL_MAX) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["crops"], message: "register.errShareSum" });
      }
    });
}

/** The urgent/buffer request schema: a positive volume and a non-empty reason. */
export const requestSchema = z.object({
  volume_m3: z
    .number()
    .refine((value) => Number.isFinite(value) && value > 0, { message: "ask.errVolume" }),
  reason: z.string().refine((value) => value.trim().length > 0, { message: "ask.errReason" }),
});

/** Validate a registration, returning de-duplicated i18n error keys (empty when valid). */
export function validateRegistration(input: RegistrationFormInput, todayIso: string): string[] {
  const result = registrationSchema(todayIso).safeParse(input);
  if (result.success) return [];
  return [...new Set(result.error.issues.map((issue) => issue.message))];
}

/** Validate a request, returning de-duplicated i18n error keys (empty when valid). */
export function validateRequest(volume_m3: number, reason: string): string[] {
  const result = requestSchema.safeParse({ volume_m3, reason });
  if (result.success) return [];
  return [...new Set(result.error.issues.map((issue) => issue.message))];
}
