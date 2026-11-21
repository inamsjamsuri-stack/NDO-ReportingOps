import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"

import { PageHeader, Tag } from "@/components/Common/Badges"
import useCustomToast from "@/hooks/useCustomToast"
import { personName, useLookups } from "@/hooks/useLookups"
import { api, errorMessage } from "@/lib/api"
import { FREQUENCY } from "@/lib/format"
import type { AutomationStatus, Frequency, Report } from "@/lib/types"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_layout/catalog")({
  component: CatalogPage,
  head: () => ({ meta: [{ title: "Report catalog - ReportOps" }] }),
})

const AUTO: Record<AutomationStatus, { label: string; tone: "good" | "warn" | "bad" }> = {
  fully_automated: { label: "Fully automated", tone: "good" },
  hybrid: { label: "Hybrid", tone: "warn" },
  manual: { label: "Manual", tone: "bad" },
}
const inputCls = "h-9 w-full rounded border border-input bg-background px-3 text-sm"
const btn = "inline-flex h-9 items-center rounded border px-3.5 text-sm font-medium disabled:opacity-50"
const btnPrimary = `${btn} border-primary bg-primary text-primary-foreground hover:bg-[#9E1271]`

function CatalogPage() {
  const lk = useLookups()
  const canEdit = lk.me?.role === "manager" || lk.me?.role === "admin"
  const [q, setQ] = useState("")
  const [auto, setAuto] = useState("")
  const [editing, setEditing] = useState<Report | "new" | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ["reports", "catalog", q, auto],
    queryFn: () => api.reports({ q: q || undefined, automation_status: auto || undefined }),
  })
  const rows = data ?? []
  const manualHours = rows
    .filter((r) => r.automation_status !== "fully_automated")
    .reduce((a, r) => a + Number(r.manual_effort_hours ?? 0), 0)

  return (
    <div>
      <PageHeader
        title="Report catalog"
        subtitle={`${rows.length} reports · ${manualHours} manual hours per run across hybrid and manual reports`}
      >
        {canEdit && (
          <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>
            Add report
          </button>
        )}
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        <label className="sr-only" htmlFor="c-q">Search</label>
        <input id="c-q" type="search" placeholder="Search name or code…" className={cn(inputCls, "max-w-[320px]")} value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="sr-only" htmlFor="c-auto">Automation</label>
        <select id="c-auto" className={cn(inputCls, "w-auto")} value={auto} onChange={(e) => setAuto(e.target.value)}>
          <option value="">All automation levels</option>
          {(Object.keys(AUTO) as AutomationStatus[]).map((k) => <option key={k} value={k}>{AUTO[k].label}</option>)}
        </select>
      </div>

      {editing && (
        <ReportForm
          report={editing === "new" ? null : editing}
          ownerOnly={!canEdit}
          onDone={() => setEditing(null)}
        />
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr className="text-left text-xs text-muted-foreground">
              {["Code", "Report", "Customer", "Domain", "Frequency", "Owner", "Automation", "Manual h/run", "Why not automated", ""].map((h) => (
                <th key={h} scope="col" className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={10} className="px-3 py-8 text-center text-muted-foreground">No reports in the catalog yet.</td></tr>
            )}
            {rows.map((r) => {
              const mine = r.owner_id === lk.me?.id
              return (
                <tr key={r.id} className="border-t align-top">
                  <td className="tabular whitespace-nowrap px-3 py-2.5 text-muted-foreground">{r.code}</td>
                  <td className="px-3 py-2.5 font-medium">{r.name}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{lk.customerById[r.customer_id]?.name ?? "—"}</td>
                  <td className="px-3 py-2.5">{lk.domainById[r.domain_id]?.name ?? "—"}</td>
                  <td className="px-3 py-2.5">{FREQUENCY[r.frequency]}</td>
                  <td className="whitespace-nowrap px-3 py-2.5">{personName(lk.personById, r.owner_id, lk.me?.id)}</td>
                  <td className="px-3 py-2.5"><Tag tone={AUTO[r.automation_status].tone}>{AUTO[r.automation_status].label}</Tag></td>
                  <td className="tabular px-3 py-2.5 text-right">{r.manual_effort_hours ? Number(r.manual_effort_hours) : "—"}</td>
                  <td className="max-w-[260px] px-3 py-2.5 text-muted-foreground">{r.automation_blocker ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    {(canEdit || mine) && (
                      <button type="button" className="text-primary hover:underline" onClick={() => setEditing(r)}>Edit</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ReportForm({ report, ownerOnly, onDone }: { report: Report | null; ownerOnly: boolean; onDone: () => void }) {
  const qc = useQueryClient()
  const lk = useLookups()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [name, setName] = useState(report?.name ?? "")
  const [customer, setCustomer] = useState(report?.customer_id ?? "")
  const [domain, setDomain] = useState(report?.domain_id ?? "")
  const [frequency, setFrequency] = useState<Frequency>(report?.frequency ?? "monthly")
  const [owner, setOwner] = useState(report?.owner_id ?? "")
  const [auto, setAuto] = useState<AutomationStatus>(report?.automation_status ?? "manual")
  const [hours, setHours] = useState(report?.manual_effort_hours ? String(Number(report.manual_effort_hours)) : "")
  const [blocker, setBlocker] = useState(report?.automation_blocker ?? "")
  const [conditions, setConditions] = useState(report?.automation_conditions ?? "")
  const needsWhy = auto !== "fully_automated"

  const save = useMutation({
    mutationFn: () => {
      const automation = {
        automation_status: auto,
        manual_effort_hours: needsWhy ? hours : null,
        automation_blocker: needsWhy ? blocker : null,
        automation_conditions: needsWhy ? conditions : null,
      }
      if (ownerOnly && report) return api.updateReport(report.id, automation)
      const body = { name, customer_id: customer, domain_id: domain, frequency, owner_id: owner || null, ...automation }
      return report ? api.updateReport(report.id, body) : api.createReport(body)
    },
    onSuccess: () => {
      showSuccessToast("Report saved")
      qc.invalidateQueries({ queryKey: ["reports"] })
      onDone()
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })

  return (
    <form
      className="mb-5 grid gap-3 rounded-md border bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <h2 className="text-sm font-semibold sm:col-span-2 lg:col-span-4">{report ? `Edit ${report.code}` : "Add report"}</h2>
      {!ownerOnly && (
        <>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            Report name
            <input required className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Customer
            <select required className={inputCls} value={customer} onChange={(e) => setCustomer(e.target.value)}>
              <option value="">Choose…</option>
              {lk.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Domain
            <select required className={inputCls} value={domain} onChange={(e) => setDomain(e.target.value)}>
              <option value="">Choose…</option>
              {lk.domains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Frequency
            <select className={inputCls} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {Object.entries(FREQUENCY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Owner
            <select className={inputCls} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">No owner</option>
              {lk.engineers.map((p) => <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>)}
            </select>
          </label>
        </>
      )}
      <label className="flex flex-col gap-1 text-xs">
        Automation
        <select className={inputCls} value={auto} onChange={(e) => setAuto(e.target.value as AutomationStatus)}>
          {(Object.keys(AUTO) as AutomationStatus[]).map((k) => <option key={k} value={k}>{AUTO[k].label}</option>)}
        </select>
      </label>
      {needsWhy && (
        <>
          <label className="flex flex-col gap-1 text-xs">
            Manual effort (hours per run)
            <input required type="number" min="0" step="0.25" className={inputCls} value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            Why is it not fully automated?
            <textarea required rows={2} className={cn(inputCls, "h-auto py-2")} value={blocker} onChange={(e) => setBlocker(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs sm:col-span-2">
            What is needed to automate it?
            <textarea required rows={2} className={cn(inputCls, "h-auto py-2")} value={conditions} onChange={(e) => setConditions(e.target.value)} />
          </label>
        </>
      )}
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={btnPrimary} disabled={save.isPending}>Save</button>
        <button type="button" className={btn} onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}
