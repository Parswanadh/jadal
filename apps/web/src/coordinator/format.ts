export function fmtM3(v: number): string {
  return `${Math.round(v).toLocaleString("en-IN")} m³`;
}

export function fmtPct(v: number): string {
  return `${String(Math.round(v))}%`;
}

export function fmtFlow(v: number): string {
  return `${v.toFixed(4)} m³/s`;
}

export function fmtDur(h: number): string {
  const whole = Math.floor(h);
  const mins = Math.round((h - whole) * 60);
  return `${String(whole)}h ${String(mins).padStart(2, "0")}m`;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}
