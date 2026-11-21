import { PRIORITY, STATUS } from "@/lib/format"
import type { Priority, Status } from "@/lib/types"
import { cn } from "@/lib/utils"

export function StatusBadge({ status, className }: { status: Status; className?: string }) {
  const s = STATUS[status]
  return (
    <span
      className={cn("inline-flex items-center whitespace-nowrap rounded-[3px] px-2 py-0.5 text-xs font-medium", className)}
      style={{ background: s.bg, color: s.fg }}
    >
      {s.label}
    </span>
  )
}

export function PriorityLabel({ priority }: { priority: Priority }) {
  const p = PRIORITY[priority]
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden className="size-2 rounded-full" style={{ background: p.dot }} />
      {p.label}
    </span>
  )
}

type Tone = "neutral" | "warn" | "good" | "bad" | "brand"

const TONES: Record<Tone, { bg: string; fg: string }> = {
  neutral: { bg: "#F2F2F2", fg: "#3A3A3C" },
  warn: { bg: "#FFF6D6", fg: "#7A5A00" },
  good: { bg: "#E6F6F4", fg: "#0F6B61" },
  bad: { bg: "#FDE8E9", fg: "#B3141B" },
  brand: { bg: "#FCEAF4", fg: "#9E1271" },
}

export function Tag({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  const t = TONES[tone]
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] px-2 py-0.5 text-xs font-medium"
      style={{ background: t.bg, color: t.fg }}
    >
      {children}
    </span>
  )
}

/** SLA state of a request in one tag: overdue beats at risk beats on track. */
export function SlaTag({
  status,
  committed,
  isOverdue,
  atRisk,
}: {
  status: Status
  committed: string | null
  isOverdue: boolean
  atRisk?: boolean
}) {
  if (["completed", "cancelled", "rejected"].includes(status)) return <Tag>Closed</Tag>
  if (status === "on_hold") return <Tag>Paused</Tag>
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jakarta" })
  if (isOverdue || (committed && committed < today)) return <Tag tone="bad">Overdue</Tag>
  if (atRisk) return <Tag tone="warn">At risk</Tag>
  if (!committed) return <Tag>Not committed</Tag>
  return <Tag tone="good">On track</Tag>
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: React.ReactNode
  children?: React.ReactNode
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

export function Panel({ title, action, children, className }: {
  title?: React.ReactNode
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={cn("rounded-md border bg-card", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 px-5 pb-1 pt-4">
          {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      <div className="p-5 pt-3">{children}</div>
    </section>
  )
}
