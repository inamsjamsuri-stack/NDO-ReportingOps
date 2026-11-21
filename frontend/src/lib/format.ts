import type { Priority, Status } from "./types"

/** Status words and badge colours (IOH brand: yellow = attention,
 * teal = done or safe, magenta = in work, red = overdue). */
export const STATUS: Record<Status, { label: string; bg: string; fg: string; dot: string }> = {
  submitted: { label: "Submitted", bg: "#F2F2F2", fg: "#3A3A3C", dot: "#A1A1AA" },
  under_assessment: { label: "Under assessment", bg: "#FFF6D6", fg: "#7A5A00", dot: "#FFCB05" },
  approved: { label: "Approved", bg: "#E5F4FB", fg: "#00648D", dot: "#0096D4" },
  assigned: { label: "Assigned", bg: "#EDEDED", fg: "#2D2D2D", dot: "#4D4D4F" },
  in_progress: { label: "In progress", bg: "#FCEAF4", fg: "#9E1271", dot: "#C6168D" },
  under_review: { label: "Under review", bg: "#E6F6F4", fg: "#0F6B61", dot: "#32BCAD" },
  completed: { label: "Completed", bg: "#E6F6F4", fg: "#0F6B61", dot: "#32BCAD" },
  rejected: { label: "Rejected", bg: "#FDE8E9", fg: "#B3141B", dot: "#ED1C24" },
  on_hold: { label: "On hold", bg: "#F2F2F2", fg: "#6B6B6E", dot: "#A1A1AA" },
  cancelled: { label: "Cancelled", bg: "#F2F2F2", fg: "#6B6B6E", dot: "#A1A1AA" },
}

export const BOARD_COLUMNS: Status[] = [
  "submitted",
  "under_assessment",
  "approved",
  "assigned",
  "in_progress",
  "under_review",
  "on_hold",
]

export const OPEN_STATUSES: Status[] = [
  "submitted",
  "under_assessment",
  "approved",
  "assigned",
  "in_progress",
  "under_review",
  "on_hold",
]

export const PRIORITY: Record<Priority, { label: string; dot: string }> = {
  critical: { label: "Critical", dot: "#ED1C24" },
  high: { label: "High", dot: "#E8590C" },
  medium: { label: "Medium", dot: "#CA8A04" },
  low: { label: "Low", dot: "#71717A" },
}

export const FREQUENCY: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  one_time: "One-time",
}

export const CATEGORY: Record<string, string> = { regular: "Regular", ad_hoc: "Ad hoc" }

export const ROLE: Record<string, string> = {
  admin: "Administrator",
  manager: "Manager",
  engineer: "Engineer",
  requester: "Requester",
}

/** Labels and button styles for workflow actions. */
export const ACTIONS: Record<string, { label: string; primary?: boolean; needsReason?: boolean }> = {
  open_assessment: { label: "Start assessment", primary: true },
  need_more_info: { label: "Ask for more info", needsReason: true },
  approve: { label: "Approve", primary: true },
  reject: { label: "Reject", needsReason: true },
  assign: { label: "Mark as assigned", primary: true },
  start: { label: "Start work", primary: true },
  submit_review: { label: "Submit for review", primary: true },
  rework: { label: "Send back for rework", needsReason: true },
  complete: { label: "Complete", primary: true },
  hold: { label: "Put on hold", needsReason: true },
  resume: { label: "Resume", primary: true },
  cancel: { label: "Cancel request" },
  reopen: { label: "Reopen", needsReason: true },
}

const TZ = "Asia/Jakarta"

export function fmtDate(value: string | null | undefined): string {
  if (!value) return "—"
  const d = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value)
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(value.length === 10 ? {} : { timeZone: TZ }),
  })
}

export function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TZ,
  })
}

export function fmtHours(minutes: number | null | undefined): string {
  if (minutes === null || minutes === undefined) return "—"
  const h = minutes / 60
  return `${Number.isInteger(h) ? h : h.toFixed(1)} h`
}

/** Today's date in Jakarta as YYYY-MM-DD. */
export function todayJakarta(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ })
}

export function initials(name: string | null | undefined): string {
  if (!name) return "–"
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("")
}
