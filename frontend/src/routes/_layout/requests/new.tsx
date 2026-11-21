import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Upload } from "lucide-react"
import { type FormEvent, useEffect, useMemo, useState } from "react"

import { PageHeader } from "@/components/Common/Badges"
import useCustomToast from "@/hooks/useCustomToast"
import { useLookups } from "@/hooks/useLookups"
import { api, errorMessage } from "@/lib/api"
import { fmtHours, PRIORITY, todayJakarta } from "@/lib/format"
import type { Category, Frequency, Priority } from "@/lib/types"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_layout/requests/new")({
  component: NewRequestPage,
  head: () => ({ meta: [{ title: "New request - ReportOps" }] }),
})

const inputCls =
  "h-10 w-full rounded border border-input bg-background px-3 text-sm focus:border-primary focus:outline-2 focus:outline-[#E68AC4]"
const ALLOWED = ".xlsx,.csv,.pdf,.docx,.pptx,.png,.jpg,.jpeg,.zip"
const MAX_BYTES = 25 * 1024 * 1024

function Field({ label, htmlFor, help, required, children }: {
  label: string
  htmlFor?: string
  help?: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-semibold">
        {label} {required && <span className="text-destructive">*</span>}
      </label>
      {children}
      {help && <span className="text-xs text-muted-foreground">{help}</span>}
    </div>
  )
}

function Segment<T extends string>({ value, options, onChange, disabled, name }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  disabled?: T[]
  name: string
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = o.value === value
        const off = disabled?.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={off}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-9 items-center gap-2 rounded border px-3.5 text-sm",
              on ? "border-primary bg-accent font-semibold text-accent-foreground" : "border-input bg-background",
              off && "cursor-not-allowed opacity-45",
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function NewRequestPage() {
  const lk = useLookups()
  const navigate = useNavigate()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const isManager = lk.me?.role === "manager"

  const [title, setTitle] = useState("")
  const [customerId, setCustomerId] = useState("")
  const [typeId, setTypeId] = useState("")
  const [domainId, setDomainId] = useState("")
  const [frequency, setFrequency] = useState<Frequency>("weekly")
  const [category, setCategory] = useState<Category>("regular")
  const [reportMode, setReportMode] = useState<"catalog" | "new">("catalog")
  const [reportId, setReportId] = useState("")
  const [reportName, setReportName] = useState("")
  const [purpose, setPurpose] = useState("")
  const [priority, setPriority] = useState<Priority>("medium")
  const [requiredDate, setRequiredDate] = useState("")
  const [onBehalf, setOnBehalf] = useState("")
  const [files, setFiles] = useState<File[]>([])

  // Sensible defaults once lists load.
  useEffect(() => {
    if (!customerId && lk.me?.customer_id) setCustomerId(lk.me.customer_id)
  }, [lk.me, customerId])
  useEffect(() => {
    if (!typeId && lk.requestTypes[0]) setTypeId(lk.requestTypes[0].id)
  }, [lk.requestTypes, typeId])
  useEffect(() => {
    if (!domainId && lk.domains[0]) setDomainId(lk.domains[0].id)
  }, [lk.domains, domainId])

  // A one-time report is always ad hoc.
  const oneTime = frequency === "one_time"
  const effectiveCategory: Category = oneTime ? "ad_hoc" : category

  const reports = useQuery({
    queryKey: ["reports", customerId],
    queryFn: () => api.reports(customerId ? { customer_id: customerId } : undefined),
  })
  useEffect(() => {
    if (reportMode === "catalog" && (reports.data ?? []).length === 0 && reports.isSuccess) setReportMode("new")
  }, [reports.data, reports.isSuccess, reportMode])

  const policies = useQuery({ queryKey: ["sla-policies"], queryFn: api.slaPolicies })
  const target = useMemo(() => {
    const rows = (policies.data ?? []).filter((p) => p.is_active && p.priority === priority)
    const match = rows
      .filter((p) => (!p.category || p.category === effectiveCategory) && (!p.request_type_id || p.request_type_id === typeId))
      .sort((a, b) => Number(!!b.category) + Number(!!b.request_type_id) - Number(!!a.category) - Number(!!a.request_type_id))
    return match[0]
  }, [policies.data, priority, effectiveCategory, typeId])

  const create = useMutation({
    mutationFn: async () => {
      const req = await api.createRequest({
        title: title.trim(),
        requester_id: isManager && onBehalf ? onBehalf : null,
        customer_id: customerId,
        category: effectiveCategory,
        request_type_id: typeId,
        domain_id: domainId,
        report_id: reportMode === "catalog" && reportId ? reportId : null,
        report_name: reportMode === "new" ? reportName.trim() : null,
        frequency,
        business_purpose: purpose.trim(),
        priority,
        required_date: requiredDate,
      })
      const failed: string[] = []
      for (const f of files) {
        try {
          await api.upload(req.id, f, false, "public")
        } catch {
          failed.push(f.name)
        }
      }
      return { req, failed }
    },
    onSuccess: ({ req, failed }) => {
      showSuccessToast(`Request ${req.code} submitted`)
      if (failed.length) showErrorToast(`Could not upload: ${failed.join(", ")}`)
      navigate({ to: "/requests/$requestId", params: { requestId: req.id } })
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const next = [...files]
    for (const f of Array.from(list)) {
      if (f.size > MAX_BYTES) {
        showErrorToast(`${f.name} is larger than 25 MB`)
        continue
      }
      if (next.length >= 10) {
        showErrorToast("Up to 10 files per request")
        break
      }
      next.push(f)
    }
    setFiles(next)
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (reportMode === "catalog" && !reportId) {
      showErrorToast("Pick a report from the catalog, or choose New report name")
      return
    }
    create.mutate()
  }

  const requesters = Object.values(lk.personById).filter((p) => p.role === "requester")

  return (
    <div>
      <nav className="mb-2 text-sm text-muted-foreground">
        <Link to="/requests" className="hover:underline">Inbox</Link> / New request
      </nav>
      <PageHeader
        title="New reporting request"
        subtitle={<>Fields with <span className="text-destructive">*</span> are required. You can edit the request until a manager starts the assessment.</>}
      />
      <div className="flex flex-wrap items-start gap-6">
        <form onSubmit={submit} className="flex min-w-0 max-w-[760px] grow-[999] basis-[560px] flex-col gap-5">
          {isManager && (
            <Field label="Submit on behalf of" htmlFor="n-behalf" help="Leave empty to submit as yourself.">
              <select id="n-behalf" className={inputCls} value={onBehalf} onChange={(e) => setOnBehalf(e.target.value)}>
                <option value="">Myself</option>
                {requesters.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </select>
            </Field>
          )}
          <Field label="Request title" htmlFor="n-title" required help="Short and specific, up to 150 characters.">
            <input id="n-title" className={inputCls} required minLength={3} maxLength={150} value={title}
              onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Weekly 4G KPI report – East Java" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Customer / department" htmlFor="n-cust" required>
              <select id="n-cust" className={inputCls} required value={customerId} onChange={(e) => { setCustomerId(e.target.value); setReportId("") }}>
                <option value="" disabled>Choose…</option>
                {lk.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Request type" htmlFor="n-type" required>
              <select id="n-type" className={inputCls} required value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                {lk.requestTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Domain" htmlFor="n-domain" required help="One domain per request. Split the work if it covers more.">
              <select id="n-domain" className={inputCls} required value={domainId} onChange={(e) => setDomainId(e.target.value)}>
                {lk.domains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Frequency" htmlFor="n-freq" required>
              <select id="n-freq" className={inputCls} value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="one_time">One-time</option>
              </select>
            </Field>
          </div>
          <Field label="Category" required help={oneTime ? "One-time reports are always Ad hoc." : undefined}>
            <Segment<Category>
              name="Category"
              value={effectiveCategory}
              onChange={setCategory}
              disabled={oneTime ? ["regular"] : undefined}
              options={[{ value: "regular", label: "Regular" }, { value: "ad_hoc", label: "Ad hoc" }]}
            />
          </Field>
          <Field label="Report" required>
            <Segment<"catalog" | "new">
              name="Report source"
              value={reportMode}
              onChange={setReportMode}
              options={[{ value: "catalog", label: "From catalog" }, { value: "new", label: "New report name" }]}
            />
            {reportMode === "catalog" ? (
              <>
                <label htmlFor="n-report" className="sr-only">Pick a report</label>
                <select id="n-report" className={inputCls} value={reportId} onChange={(e) => setReportId(e.target.value)}>
                  <option value="">Pick a report…</option>
                  {(reports.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name}</option>)}
                </select>
              </>
            ) : (
              <>
                <label htmlFor="n-newrep" className="sr-only">New report name</label>
                <input id="n-newrep" className={inputCls} required maxLength={200} value={reportName}
                  onChange={(e) => setReportName(e.target.value)} placeholder="Name of the new report" />
                <span className="text-xs text-muted-foreground">A manager links it to the catalog when the request is completed.</span>
              </>
            )}
          </Field>
          <Field label="Business purpose" htmlFor="n-purpose" required>
            <textarea id="n-purpose" className={cn(inputCls, "h-auto py-2.5")} rows={4} required minLength={10} value={purpose}
              onChange={(e) => setPurpose(e.target.value)} placeholder="Who uses this report, for what decision or meeting, and what must be in it." />
          </Field>
          <Field label="Priority" required help="The manager confirms the final priority.">
            <Segment<Priority>
              name="Priority"
              value={priority}
              onChange={setPriority}
              options={(Object.keys(PRIORITY) as Priority[]).map((p) => ({ value: p, label: PRIORITY[p].label }))}
            />
          </Field>
          <div className="max-w-[280px]">
            <Field label="Required date" htmlFor="n-date" required help="When you need it. The team agrees a committed date at approval.">
              <input id="n-date" type="date" className={inputCls} required min={todayJakarta()} value={requiredDate}
                onChange={(e) => setRequiredDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Attachments">
            <label htmlFor="n-files" className="flex cursor-pointer flex-col items-center gap-1.5 rounded-md border-[1.5px] border-dashed border-[#C4C4CC] bg-muted/50 p-5 text-center">
              <Upload className="size-5 text-muted-foreground" aria-hidden />
              <span className="text-sm font-medium">Click to add files</span>
              <span className="text-xs text-muted-foreground">xlsx, csv, pdf, docx, pptx, png, jpg, zip · up to 25 MB each · max 10 files</span>
              <input id="n-files" type="file" multiple accept={ALLOWED} className="sr-only" onChange={(e) => addFiles(e.target.files)} />
            </label>
            {files.length > 0 && (
              <ul className="flex flex-col gap-1 text-sm">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`} className="flex items-center justify-between rounded border px-3 py-1.5">
                    <span className="truncate">{f.name}</span>
                    <button type="button" className="text-xs text-primary hover:underline"
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Field>
          <div className="flex justify-end gap-2.5 border-t pt-4">
            <Link to="/requests" className="inline-flex h-10 items-center rounded border px-4 text-sm font-medium">Cancel</Link>
            <button type="submit" disabled={create.isPending}
              className="inline-flex h-10 items-center rounded bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-[#9E1271] disabled:opacity-60">
              {create.isPending ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </form>

        <aside className="flex min-w-0 grow basis-[300px] flex-col gap-4">
          <section className="flex flex-col gap-2.5 rounded-md border p-4">
            <h2 className="text-sm font-semibold">Expected timing</h2>
            <Row label="Priority" value={PRIORITY[priority].label} />
            <Row label="First response within" value={target ? fmtHours(target.response_target_min) : "—"} />
            <Row label="Delivery after approval" value={target ? fmtHours(target.resolution_target_min) : "—"} />
            <span className="text-xs text-muted-foreground">
              Working hours: Mon–Fri, 08:30–18:00 WIB, break 12:30–14:00. Holidays excluded.
            </span>
          </section>
          <section className="flex flex-col gap-2 rounded-md border p-4">
            <h2 className="text-sm font-semibold">What happens next</h2>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
              <li>You get an ID like RPT-2026-00154.</li>
              <li>A manager reviews it, may ask for more info, then approves with a committed date.</li>
              <li>Engineers are assigned and start work.</li>
              <li>You follow progress on the request page and get an email when it is done.</li>
            </ol>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-muted-foreground">{label}</span>
      <b>{value}</b>
    </div>
  )
}
