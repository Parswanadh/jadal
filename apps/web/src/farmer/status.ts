import type { WaterRequest } from "@jadal/contracts";

/** Colour family for a request status pill. */
export function statusTone(status: WaterRequest["status"]): "ok" | "crit" | "warn" {
  if (status === "approved" || status === "delivered" || status === "confirmed" || status === "scheduled" || status === "released") return "ok";
  if (status === "rejected" || status === "cancelled" || status === "expired") return "crit";
  return "warn";
}
