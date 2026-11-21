import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { useState } from "react"

import { PageHeader, Panel, SlaTag } from "@/components/Common/Badges"
import { personName, useLookups } from "@/hooks/useLookups"
import { api } from "@/lib/api"
import { CATEGORY, fmtDate, PRIORITY } from "@/lib/format"
import type { Priority } from "@/lib/types"

export const Route = createFileRoute("/_layout/")({
  component: DashboardPage,
  head: () => ({ meta: [{ title: "Dashboard - ReportOps" }] }),
})

type RangeKey = "month" | "last_month" | "quarter" | "year"

function rangeDates(key: RangeKey): { date_from: string; date_to: string; label: string } {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }))
  const iso = (d: Date) => d.toLocaleDateString("en-CA")
  const y = today.getFullYear()
  const m = today.getMonth()
  if (key === "last_month") {
    return { date_from: iso(new Date(y, m - 1, 1)), date_to: iso(new Date(y, m, 0)), label: "Last month" }
  }
  if (key === "quarter") {
    const q = Math.floor(m / 3) * 3
    return { date_from: iso(new Date(y, q, 1)), date_to: iso(today), label: "This quarter" }
  }
  if (key === "year") return { date_from: iso(new Date(y, 0, 1)), date_to: iso(today), label: "This year" }
  return { date_from: iso(new Date(y, m, 1)), date_to: iso(today), label: "This month" }
}

const selectCls = "h-9 rounded border border-input bg-background px-3 text-sm"

function DashboardPage() {
  const lk = useLookups()
  const [range, setRange] = useState<RangeKey>("month")
  const [customer, setCustomer] = useState("")
  const [domain, setDomain] = useState("")
  const [priority, setPriority] = useState("")
  const r = rangeDates(range)
  const params = {
    date_from: r.date_from,
    date_to: r.date_to,
    customer_id: customer || undefined,
    domain_id: domain || undefined,
    priority: priority || undefined,
  }
  const { data: d, isLoading } = useQuery({ queryKey: ["dashboard", params], queryFn: () => api.dashboard(params) })
  const risky = useQuery({
    queryKey: ["requests", "overdue-dash", customer, domain],
    queryFn: () =>
      api.requests({
        overdue: true,
        customer_id: customer || undefined,
        domain_id: domain || undefined,
        limit: 8,
      }),
  })

  const maxDomain = Math.max(1, ...(d?.by_domain ?? []).map((x) => x.count))
  const totalCat = (d?.by_category ?? []).reduce((a, x) => a + x.count, 0)

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Reporting Department · ${r.label} (${fmtDate(r.date_from)} – ${fmtDate(r.date_to)})`}
      >
        <label className="sr-only" htmlFor="f-range">Period</label>
        <select id="f-range" className={selectCls} value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>
          <option value="month">This month</option>
          <option value="last_month">Last month</option>
          <option value="quarter">This quarter</option>
          <option value="year">This year</option>
        </select>
        <label className="sr-only" htmlFor="f-cust">Customer</label>
        <select id="f-cust" className={selectCls} value={customer} onChange={(e) => setCustomer(e.target.value)}>
          <option value="">All customers</option>
          {lk.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-domain">Domain</label>
        <select id="f-domain" className={selectCls} value={domain} onChange={(e) => setDomain(e.target.value)}>
          <option value="">All domains</option>
          {lk.domains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="f-prio">Priority</label>
        <select id="f-prio" className={selectCls} value={priority} onChange={(e) => setPriority(e.target.value)}>
          <option value="">All priorities</option>
          {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
        </select>
      </PageHeader>

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="Total incoming" value={d?.total_incoming} note="submitted in period" loading={isLoading} link />
        <Kpi label="Open" value={d?.open} note="submitted to assigned, now" loading={isLoading} link status={["submitted", "under_assessment", "approved", "assigned"]} />
        <Kpi label="In progress" value={d?.in_progress} note="in progress + under review" loading={isLoading} link status={["in_progress", "under_review"]} />
        <Kpi label="Overdue" value={d?.overdue} note="past committed date" loading={isLoading} tone="bad" link overdue />
        <Kpi label="Completed" value={d?.completed} note="in period" loading={isLoading} link status={["completed"]} />
        <Kpi label="On hold" value={d?.on_hold} note="SLA clock paused" loading={isLoading} link status={["on_hold"]} />
        <Kpi
          label="Avg resolution time"
          value={d?.avg_resolution_hours == null ? "—" : `${d.avg_resolution_hours} h`}
          note={d?.median_resolution_hours == null ? "working hours" : `median ${d.median_resolution_hours} h · working hours`}
          loading={isLoading}
        />
        <Kpi
          label="SLA compliance"
          value={d?.sla_compliance_pct == null ? "—" : `${d.sla_compliance_pct}%`}
          note="completed within target"
          loading={isLoading}
          tone={d?.sla_compliance_pct != null && d.sla_compliance_pct >= 90 ? "good" : undefined}
        />
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Panel title="Incoming by domain" action={<span className="text-xs text-muted-foreground">{d?.total_incoming ?? 0} requests</span>}>
          <div className="flex flex-col gap-3">
            {(d?.by_domain ?? []).length === 0 && <Empty />}
            {(d?.by_domain ?? []).map((x) => (
              <div key={x.name} className="grid grid-cols-[110px_1fr_36px] items-center gap-3">
                <span className="text-sm">{x.name}</span>
                <div className="h-2.5 rounded-full bg-muted">
                  <div className="h-2.5 rounded-full bg-[#4D4D4F]" style={{ width: `${(x.count / maxDomain) * 100}%` }} />
                </div>
                <span className="tabular text-right text-sm font-semibold">{x.count}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Incoming by category" action={<span className="text-xs text-muted-foreground">{totalCat} requests</span>}>
          {totalCat === 0 ? (
            <Empty />
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex h-7 overflow-hidden rounded">
                {d?.by_category.map((x) => (
                  <div
                    key={x.name}
                    style={{ width: `${(x.count / totalCat) * 100}%`, background: x.name === "regular" ? "#C6168D" : "#FFCB05" }}
                    title={`${CATEGORY[x.name] ?? x.name}: ${x.count}`}
                  />
                ))}
              </div>
              <div className="flex gap-6 text-sm">
                {d?.by_category.map((x) => (
                  <span key={x.name} className="flex items-center gap-2">
                    <span className="size-2.5 rounded-sm" style={{ background: x.name === "regular" ? "#C6168D" : "#FFCB05" }} />
                    {CATEGORY[x.name] ?? x.name} <b>{x.count}</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        className="mt-4"
        title="Overdue requests"
        action={
          <Link to="/requests" search={{ overdue: true }} className="text-sm text-primary hover:underline">
            Open in inbox
          </Link>
        }
      >
        {(risky.data?.data ?? []).length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Nothing is overdue.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-5 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Requester</th>
                  <th className="px-3 py-2 font-medium">Committed</th>
                  <th className="px-3 py-2 font-medium">SLA</th>
                </tr>
              </thead>
              <tbody>
                {risky.data?.data.map((q) => (
                  <tr key={q.id} className="border-b last:border-0">
                    <td className="tabular px-5 py-2.5 text-muted-foreground">{q.code}</td>
                    <td className="px-3 py-2.5">
                      <Link to="/requests/$requestId" params={{ requestId: q.id }} className="font-medium hover:underline">
                        {q.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5">{lk.customerById[q.customer_id]?.name ?? "—"}</td>
                    <td className="px-3 py-2.5">{personName(lk.personById, q.requester_id, lk.me?.id)}</td>
                    <td className="px-3 py-2.5">{fmtDate(q.committed_date)}</td>
                    <td className="px-3 py-2.5">
                      <SlaTag status={q.status} committed={q.committed_date} isOverdue={q.is_overdue} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

function Kpi({
  label,
  value,
  note,
  loading,
  tone,
  link,
  status,
  overdue,
}: {
  label: string
  value: number | string | undefined
  note: string
  loading?: boolean
  tone?: "bad" | "good"
  link?: boolean
  status?: string[]
  overdue?: boolean
}) {
  const color = tone === "bad" ? "#B3141B" : tone === "good" ? "#0F6B61" : undefined
  const inner = (
    <>
      <span className="text-sm" style={{ color: tone === "bad" ? color : undefined }}>{label}</span>
      <span className="tabular text-3xl font-semibold" style={{ color }}>
        {loading ? "…" : (value ?? 0)}
      </span>
      <span className="text-xs text-muted-foreground">{note}</span>
    </>
  )
  const cls =
    "flex flex-col gap-1.5 rounded-md border bg-card p-4" +
    (tone === "bad" ? " border-[#F3B4B7] bg-[#FDF4F4]" : "")
  if (!link) return <div className={cls}>{inner}</div>
  return (
    <Link
      to="/requests"
      search={overdue ? { overdue: true } : status ? { status: status.join(",") } : { all: true }}
      className={`${cls} hover:border-primary`}
    >
      {inner}
    </Link>
  )
}

function Empty() {
  return <p className="py-4 text-sm text-muted-foreground">No requests in this period.</p>
}
