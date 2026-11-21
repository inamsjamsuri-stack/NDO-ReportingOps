import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { Clock, Download, Paperclip } from "lucide-react"
import { type FormEvent, useState } from "react"

import { PriorityLabel, SlaTag, StatusBadge, Tag } from "@/components/Common/Badges"
import useCustomToast from "@/hooks/useCustomToast"
import { personName, useLookups } from "@/hooks/useLookups"
import { api, errorMessage } from "@/lib/api"
import {
  ACTIONS,
  CATEGORY,
  FREQUENCY,
  fmtDate,
  fmtDateTime,
  fmtHours,
  initials,
  PRIORITY,
  STATUS,
  todayJakarta,
} from "@/lib/format"
import type { ActivityItem, CommentItem, Priority, RequestItem, Status, Visibility } from "@/lib/types"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_layout/requests/$requestId")({
  component: RequestDetailPage,
  head: () => ({ meta: [{ title: "Request - ReportOps" }] }),
})

const inputCls = "h-9 w-full rounded border border-input bg-background px-3 text-sm"
const btn = "inline-flex h-9 items-center gap-1.5 rounded border px-3.5 text-sm font-medium disabled:opacity-50"
const btnPrimary = `${btn} border-primary bg-primary text-primary-foreground hover:bg-[#9E1271]`

type Lookups = ReturnType<typeof useLookups>

function RequestDetailPage() {
  const { requestId } = Route.useParams()
  const qc = useQueryClient()
  const lk = useLookups()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const role = lk.me?.role
  const isStaff = role === "manager" || role === "engineer" || role === "admin"

  const req = useQuery({ queryKey: ["request", requestId], queryFn: () => api.request(requestId) })
  const actions = useQuery({ queryKey: ["actions", requestId, req.data?.status], queryFn: () => api.actions(requestId), enabled: !!req.data })
  const sla = useQuery({ queryKey: ["sla", requestId, req.data?.status], queryFn: () => api.sla(requestId), enabled: !!req.data })
  const assignments = useQuery({ queryKey: ["assignments", requestId], queryFn: () => api.assignments(requestId), enabled: !!req.data })

  const refresh = () => {
    for (const k of ["request", "actions", "sla", "assignments", "activity", "comments", "attachments", "timelogs"]) {
      qc.invalidateQueries({ queryKey: [k, requestId] })
    }
    qc.invalidateQueries({ queryKey: ["requests"] })
    qc.invalidateQueries({ queryKey: ["dashboard"] })
  }

  const [pending, setPending] = useState<string | null>(null)
  const [reason, setReason] = useState("")
  const move = useMutation({
    mutationFn: ({ action, why }: { action: string; why?: string }) => api.move(requestId, action, why),
    onSuccess: (r) => {
      showSuccessToast(`Now ${STATUS[r.status].label.toLowerCase()}`)
      setPending(null)
      setReason("")
      refresh()
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })

  if (req.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (req.isError || !req.data) {
    return (
      <p className="text-sm">
        Request not found or you cannot see it. <Link to="/requests" className="text-primary hover:underline">Back to inbox</Link>
      </p>
    )
  }
  const r = req.data
  const active = !["completed", "cancelled", "rejected"].includes(r.status)
  const used =
    sla.data?.resolution_used_min != null && sla.data.resolution_target_min
      ? sla.data.resolution_used_min / sla.data.resolution_target_min
      : null

  const runAction = (action: string) => {
    if (ACTIONS[action]?.needsReason || (action === "cancel" && role === "manager")) {
      setPending(action)
      return
    }
    move.mutate({ action })
  }

  return (
    <div className="flex flex-col gap-5">
      <nav className="text-sm text-muted-foreground">
        <Link to="/requests" className="hover:underline">Inbox</Link> / <span className="tabular">{r.code}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="tabular text-sm text-muted-foreground">{r.code}</span>
            <StatusBadge status={r.status} />
            <SlaTag status={r.status} committed={r.committed_date} isOverdue={r.is_overdue} atRisk={sla.data?.is_at_risk} />
          </div>
          <h1 className="text-2xl font-semibold">{r.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {(actions.data ?? []).map((a) => (
            <button
              key={a}
              type="button"
              disabled={move.isPending}
              onClick={() => runAction(a)}
              className={ACTIONS[a]?.primary ? btnPrimary : btn}
            >
              {ACTIONS[a]?.label ?? a}
            </button>
          ))}
        </div>
      </div>

      {pending && (
        <form
          className="flex flex-col gap-2 rounded-md border border-[#FFE27A] bg-[#FFFBEA] p-4"
          onSubmit={(e) => {
            e.preventDefault()
            move.mutate({ action: pending, why: reason })
          }}
        >
          <label htmlFor="d-reason" className="text-sm font-semibold">
            {ACTIONS[pending]?.label ?? pending}: give a reason
          </label>
          <textarea id="d-reason" required rows={2} className={cn(inputCls, "h-auto py-2")} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={move.isPending}>Confirm</button>
            <button type="button" className={btn} onClick={() => { setPending(null); setReason("") }}>Cancel</button>
          </div>
        </form>
      )}

      {role === "manager" && ["under_assessment", "approved", "assigned", "in_progress", "under_review", "on_hold"].includes(r.status) && (
        <Commitment r={r} onSaved={refresh} />
      )}

      <div className="flex flex-wrap items-start gap-6">
        <div className="flex min-w-0 grow-[999] basis-[520px] flex-col gap-5">
          <section className="rounded-md border p-5">
            <h2 className="mb-2 text-sm font-semibold">Business purpose</h2>
            <p className="whitespace-pre-line text-sm leading-relaxed text-[#3A3A3C]">{r.business_purpose}</p>
            {r.assessment_note && (
              <p className="mt-3 rounded bg-[#FFF6D6] px-3 py-2 text-sm text-[#7A5A00]">Manager note: {r.assessment_note}</p>
            )}
          </section>
          <Attachments requestId={requestId} canMarkOutput={role === "engineer" || role === "manager"} isStaff={isStaff} active={active} lk={lk} />
          <Timeline requestId={requestId} lk={lk} isStaff={isStaff} assignedToMe={!!assignments.data?.some((a) => a.engineer_id === lk.me?.id)} active={active} />
        </div>

        <aside className="flex min-w-0 grow basis-[320px] flex-col gap-4">
          <section className="flex flex-col gap-2.5 rounded-md border p-4">
            <h2 className="text-sm font-semibold">SLA</h2>
            {used !== null && (
              <>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Resolution time used</span>
                  <b style={{ color: used >= 1 ? "#B3141B" : used >= 0.75 ? "#7A5A00" : undefined }}>
                    {fmtHours(sla.data?.resolution_used_min)} of {fmtHours(sla.data?.resolution_target_min)}
                  </b>
                </div>
                <div className="h-2 rounded-full bg-muted">
                  <div className="h-2 rounded-full" style={{ width: `${Math.min(used, 1) * 100}%`, background: used >= 1 ? "#ED1C24" : used >= 0.75 ? "#FFCB05" : "#32BCAD" }} />
                </div>
              </>
            )}
            <Prop label="SLA due">{fmtDateTime(sla.data?.resolution_due_at)}</Prop>
            <Prop label="Committed date">
              <span className="flex flex-wrap items-center gap-1.5">
                {fmtDate(r.committed_date)}
                {r.committed_date && r.committed_date > r.required_date && <Tag>Later than requested</Tag>}
              </span>
            </Prop>
            <Prop label="Required date">{fmtDate(r.required_date)}</Prop>
            <Prop label="Response">
              {sla.data?.responded_at ? (
                <span className="text-[#0F6B61]">Done · {fmtDateTime(sla.data.responded_at)}</span>
              ) : (
                `Due ${fmtDateTime(sla.data?.response_due_at)}`
              )}
            </Prop>
            {sla.data && sla.data.paused_min > 0 && <Prop label="Time on hold">{fmtHours(sla.data.paused_min)}</Prop>}
            {sla.data?.resolution_min != null && <Prop label="Resolution time">{fmtHours(sla.data.resolution_min)}</Prop>}
          </section>

          <section className="flex flex-col gap-1.5 rounded-md border p-4">
            <h2 className="mb-1 text-sm font-semibold">Details</h2>
            <Prop label="Priority"><PriorityLabel priority={r.priority} /></Prop>
            <Prop label="Customer">{lk.customerById[r.customer_id]?.name ?? "—"}</Prop>
            <Prop label="Requester">{personName(lk.personById, r.requester_id, lk.me?.id)}</Prop>
            <Prop label="Domain">{lk.domainById[r.domain_id]?.name ?? "—"}</Prop>
            <Prop label="Request type">{lk.typeById[r.request_type_id]?.name ?? "—"}</Prop>
            <Prop label="Category">{CATEGORY[r.category]}</Prop>
            <Prop label="Frequency">{FREQUENCY[r.frequency]}</Prop>
            <Prop label="Report">{r.report_name ?? (r.report_id ? "From catalog" : "—")}</Prop>
            <Prop label="Est. effort">{r.estimated_hours ? `${Number(r.estimated_hours)} h` : "—"}</Prop>
            <Prop label="Submitted">{fmtDateTime(r.submitted_at)}</Prop>
          </section>

          <Engineers requestId={requestId} r={r} lk={lk} canManage={role === "manager" && active} onChanged={refresh} />
        </aside>
      </div>
    </div>
  )
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-7 grid-cols-[120px_1fr] items-center gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------

function Commitment({ r, onSaved }: { r: RequestItem; onSaved: () => void }) {
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [priority, setPriority] = useState<Priority>(r.priority)
  const [committed, setCommitted] = useState(r.committed_date ?? "")
  const [late, setLate] = useState(r.committed_late_reason ?? "")
  const [hours, setHours] = useState(r.estimated_hours ? String(Number(r.estimated_hours)) : "")
  const save = useMutation({
    mutationFn: () =>
      api.updateRequest(r.id, {
        priority,
        committed_date: committed || null,
        committed_late_reason: late || null,
        estimated_hours: hours || null,
      }),
    onSuccess: () => {
      showSuccessToast("Saved")
      onSaved()
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  const isLate = committed && committed > r.required_date
  return (
    <form
      className="flex flex-wrap items-end gap-3 rounded-md border bg-muted/40 p-4"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <span className="w-full text-sm font-semibold">Assessment (manager)</span>
      <label className="flex flex-col gap-1 text-xs">
        Priority
        <select className={inputCls} value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
          {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Committed date
        <input type="date" className={inputCls} value={committed} onChange={(e) => setCommitted(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Estimated effort (hours)
        <input type="number" min="0" step="0.5" className={cn(inputCls, "w-32")} value={hours} onChange={(e) => setHours(e.target.value)} />
      </label>
      {isLate && (
        <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-xs">
          Why later than required ({fmtDate(r.required_date)})?
          <input className={inputCls} required value={late} onChange={(e) => setLate(e.target.value)} />
        </label>
      )}
      <button type="submit" className={btn} disabled={save.isPending}>Save</button>
      <span className="w-full text-xs text-muted-foreground">
        Leave committed date empty to use the SLA due date when you approve.
      </span>
    </form>
  )
}

// ---------------------------------------------------------------------------

function Engineers({ requestId, r, lk, canManage, onChanged }: {
  requestId: string
  r: RequestItem
  lk: Lookups
  canManage: boolean
  onChanged: () => void
}) {
  const { showErrorToast } = useCustomToast()
  const { data } = useQuery({ queryKey: ["assignments", requestId], queryFn: () => api.assignments(requestId) })
  const [adding, setAdding] = useState(false)
  const [engineer, setEngineer] = useState("")
  const [arole, setArole] = useState<"primary" | "supporting">("primary")
  const [level, setLevel] = useState<"L1" | "L2">("L2")
  const [hours, setHours] = useState("")
  const assign = useMutation({
    mutationFn: () => api.assign(requestId, { engineer_id: engineer, assignment_role: arole, level, estimated_hours: hours || "0" }),
    onSuccess: () => {
      setAdding(false)
      setEngineer("")
      setHours("")
      onChanged()
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  const release = useMutation({
    mutationFn: (id: string) => api.release(requestId, id),
    onSuccess: onChanged,
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  const rows = data ?? []
  const totalEst = rows.reduce((a, x) => a + Number(x.estimated_hours), 0)
  const totalAct = rows.reduce((a, x) => a + Number(x.actual_hours), 0)
  const canAssign = canManage && !["submitted"].includes(r.status)

  return (
    <section className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Engineers</h2>
        {canAssign && !adding && (
          <button type="button" className="p-1.5 text-sm text-primary hover:underline" onClick={() => setAdding(true)}>
            Add engineer
          </button>
        )}
      </div>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No one assigned yet.</p>}
      {rows.map((a) => (
        <div key={a.id} className="flex items-center gap-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[#F0F0F0] text-xs font-semibold">
            {initials(lk.personById[a.engineer_id]?.full_name)}
          </span>
          <div className="flex min-w-0 grow flex-col">
            <span className="truncate text-sm font-semibold">{personName(lk.personById, a.engineer_id, lk.me?.id)}</span>
            <span className="text-xs text-muted-foreground">
              {a.assignment_role === "primary" ? "Primary" : "Supporting"} · {a.level}
            </span>
          </div>
          <span className="tabular text-xs">{Number(a.actual_hours)} / {Number(a.estimated_hours)} h</span>
          {canManage && (
            <button type="button" aria-label="Remove engineer" className="px-1 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => release.mutate(a.id)}>
              ✕
            </button>
          )}
        </div>
      ))}
      {rows.length > 0 && (
        <p className="border-t pt-2.5 text-xs text-muted-foreground">Actual {totalAct} h of {totalEst} h estimated</p>
      )}
      {adding && (
        <form className="flex flex-col gap-2 border-t pt-3" onSubmit={(e) => { e.preventDefault(); assign.mutate() }}>
          <label className="text-xs">
            Engineer
            <select required className={inputCls} value={engineer} onChange={(e) => setEngineer(e.target.value)}>
              <option value="">Choose…</option>
              {lk.engineers.filter((p) => !rows.some((a) => a.engineer_id === p.id)).map((p) => (
                <option key={p.id} value={p.id}>{p.full_name ?? p.email}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-3 gap-2">
            <label className="text-xs">
              Role
              <select className={inputCls} value={arole} onChange={(e) => setArole(e.target.value as "primary" | "supporting")}>
                <option value="primary">Primary</option>
                <option value="supporting">Supporting</option>
              </select>
            </label>
            <label className="text-xs">
              Level
              <select className={inputCls} value={level} onChange={(e) => setLevel(e.target.value as "L1" | "L2")}>
                <option value="L1">L1</option>
                <option value="L2">L2</option>
              </select>
            </label>
            <label className="text-xs">
              Est. hours
              <input type="number" min="0" step="0.5" className={inputCls} value={hours} onChange={(e) => setHours(e.target.value)} />
            </label>
          </div>
          {arole === "primary" && rows.some((a) => a.assignment_role === "primary") && (
            <p className="text-xs text-[#7A5A00]">This replaces the current primary engineer.</p>
          )}
          <div className="flex gap-2">
            <button type="submit" className={btnPrimary} disabled={assign.isPending}>Assign</button>
            <button type="button" className={btn} onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </form>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

function Attachments({ requestId, canMarkOutput, isStaff, active, lk }: {
  requestId: string
  canMarkOutput: boolean
  isStaff: boolean
  active: boolean
  lk: Lookups
}) {
  const qc = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const { data } = useQuery({ queryKey: ["attachments", requestId], queryFn: () => api.attachments(requestId) })
  const [asOutput, setAsOutput] = useState(false)
  const [internal, setInternal] = useState(false)
  const upload = useMutation({
    mutationFn: (f: File) => api.upload(requestId, f, asOutput, internal ? "internal" : "public"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attachments", requestId] })
      qc.invalidateQueries({ queryKey: ["activity", requestId] })
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  return (
    <section className="flex flex-col gap-2.5">
      <h2 className="text-sm font-semibold">Attachments</h2>
      <div className="flex flex-wrap gap-2.5">
        {(data ?? []).map((a) => (
          <button
            key={a.id}
            type="button"
            onClick={() => api.downloadAttachment(requestId, a).catch((e) => showErrorToast(errorMessage(e)))}
            className={cn(
              "flex min-w-[240px] items-center gap-2.5 rounded-md border px-3 py-2.5 text-left hover:border-primary",
              a.is_output && "border-[#F2B8DA] bg-accent",
            )}
          >
            <Download className="size-4 text-muted-foreground" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">{a.file_name}</span>
              <span className="text-xs text-muted-foreground">
                {(a.size_bytes / 1024).toFixed(0)} KB · {personName(lk.personById, a.uploaded_by_id, lk.me?.id)}
              </span>
            </span>
            {a.is_output && <span className="ml-2 rounded-[3px] bg-primary px-2 py-0.5 text-xs text-white">Output</span>}
            {a.visibility === "internal" && <Tag tone="warn">Internal</Tag>}
          </button>
        ))}
        {(data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No files yet.</p>}
      </div>
      {active && (
        <div className="flex flex-wrap items-center gap-3">
          <label className={cn(btn, "cursor-pointer border-dashed")}>
            <Paperclip className="size-4" aria-hidden /> {upload.isPending ? "Uploading…" : "Add file"}
            <input
              type="file"
              className="sr-only"
              accept=".xlsx,.csv,.pdf,.docx,.pptx,.png,.jpg,.jpeg,.zip"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) upload.mutate(f)
                e.target.value = ""
              }}
            />
          </label>
          {canMarkOutput && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={asOutput} onChange={(e) => setAsOutput(e.target.checked)} /> Mark as output
            </label>
          )}
          {isStaff && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /> Internal only
            </label>
          )}
        </div>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------

function describe(a: ActivityItem, lk: Lookups): string {
  const d = a.data as Record<string, string | null | undefined>
  switch (a.kind) {
    case "status_changed": {
      const to = STATUS[(d.to ?? "submitted") as Status]?.label.toLowerCase() ?? d.to
      return d.action === "submit" || !d.from ? "submitted the request" : `moved it to ${to}${d.reason ? ` — “${d.reason}”` : ""}`
    }
    case "field_changed":
      return `changed ${String(d.field).replace(/_/g, " ")} from ${d.old ?? "empty"} to ${d.new ?? "empty"}`
    case "assigned":
      return `assigned ${personName(lk.personById, d.engineer_id, lk.me?.id)} (${d.role === "primary" ? "Primary" : "Supporting"}, ${d.level})`
    case "released":
      return `removed ${personName(lk.personById, d.engineer_id, lk.me?.id)}`
    case "hours_logged":
      return `logged ${d.hours} h for ${fmtDate(d.work_date ?? null)}`
    case "file_added":
      return `added ${d.is_output ? "output file " : "file "}${d.file_name}`
    case "sla_at_risk":
      return "SLA is at risk: 75% of the time is used"
    case "overdue":
      return "request is past its committed date"
    default:
      return a.kind.replace(/_/g, " ")
  }
}

function Timeline({ requestId, lk, isStaff, assignedToMe, active }: {
  requestId: string
  lk: Lookups
  isStaff: boolean
  assignedToMe: boolean
  active: boolean
}) {
  const [tab, setTab] = useState<"activity" | "hours">("activity")
  const activity = useQuery({ queryKey: ["activity", requestId], queryFn: () => api.activity(requestId) })
  const comments = useQuery({ queryKey: ["comments", requestId], queryFn: () => api.comments(requestId) })
  const byId: Record<string, CommentItem> = {}
  for (const c of comments.data ?? []) byId[c.id] = c
  const items = [...(activity.data ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at))

  return (
    <section className="flex flex-col gap-3">
      <div className="flex gap-5 border-b">
        {(["activity", "hours"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "-mb-px h-9 border-b-2 px-1 text-sm",
              tab === t ? "border-primary font-semibold" : "border-transparent text-muted-foreground",
            )}
          >
            {t === "activity" ? "Activity" : "Hours"}
          </button>
        ))}
      </div>
      {tab === "activity" ? (
        <>
          <ol className="flex flex-col">
            {items.map((a) => {
              if (a.kind === "comment_added") {
                const c = byId[String(a.data.comment_id)]
                if (!c) return null
                const internal = c.visibility === "internal"
                return (
                  <li key={a.id} className="flex gap-3 py-2.5">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[#F0F0F0] text-[11px] font-semibold">
                      {initials(lk.personById[c.author_id]?.full_name)}
                    </span>
                    <div className={cn("flex grow flex-col gap-1.5 rounded-md border px-3.5 py-2.5", internal && "border-[#FFE27A] bg-[#FFFBEA]")}>
                      <div className="flex items-center gap-2 text-sm">
                        <b className="font-semibold">{personName(lk.personById, c.author_id, lk.me?.id)}</b>
                        <Tag tone={internal ? "warn" : "neutral"}>{internal ? "Internal" : "Public"}</Tag>
                        <span className="ml-auto text-xs text-muted-foreground">{fmtDateTime(c.created_at)}</span>
                      </div>
                      <p className="whitespace-pre-line text-sm leading-relaxed">
                        {c.deleted_at ? <i className="text-muted-foreground">Comment deleted</i> : c.body}
                      </p>
                    </div>
                  </li>
                )
              }
              return (
                <li key={a.id} className="flex items-center gap-3 py-2 text-sm text-muted-foreground">
                  <span className="flex w-7 justify-center"><span className="size-2 rounded-full bg-[#C4C4CC]" /></span>
                  <span>
                    <b className="font-semibold text-foreground">{a.actor_id ? personName(lk.personById, a.actor_id, lk.me?.id) : "System"}</b>{" "}
                    {describe(a, lk)}
                  </span>
                  <span className="ml-auto whitespace-nowrap text-xs">{fmtDateTime(a.created_at)}</span>
                </li>
              )
            })}
          </ol>
          <Composer requestId={requestId} isStaff={isStaff} />
        </>
      ) : (
        <Hours requestId={requestId} lk={lk} canLog={assignedToMe && active} />
      )}
    </section>
  )
}

function Composer({ requestId, isStaff }: { requestId: string; isStaff: boolean }) {
  const qc = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const [body, setBody] = useState("")
  const [vis, setVis] = useState<Visibility>(isStaff ? "internal" : "public")
  const internal = vis === "internal"
  const send = useMutation({
    mutationFn: () => api.addComment(requestId, body.trim(), vis),
    onSuccess: () => {
      setBody("")
      qc.invalidateQueries({ queryKey: ["comments", requestId] })
      qc.invalidateQueries({ queryKey: ["activity", requestId] })
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  return (
    <form
      className={cn("overflow-hidden rounded-md border", internal && "border-[#FFE27A] bg-[#FFFBEA]")}
      onSubmit={(e) => {
        e.preventDefault()
        if (body.trim()) send.mutate()
      }}
    >
      <label htmlFor="c-body" className="sr-only">Comment</label>
      <textarea
        id="c-body"
        rows={3}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={internal ? "Write an internal note…" : "Write a comment…"}
        className="block w-full resize-y bg-transparent px-4 py-3 text-sm outline-none"
      />
      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        {isStaff && (
          <div role="group" aria-label="Who can see this" className="inline-flex overflow-hidden rounded border bg-background">
            {(["public", "internal"] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={vis === v}
                onClick={() => setVis(v)}
                className={cn(
                  "h-8 px-3 text-sm font-semibold",
                  v === "internal" && "border-l",
                  vis === v ? (v === "internal" ? "bg-[#FFF6D6] text-[#7A5A00]" : "bg-accent text-accent-foreground") : "text-muted-foreground",
                )}
              >
                {v === "public" ? "Public" : "Internal note"}
              </button>
            ))}
          </div>
        )}
        <span className="text-xs text-muted-foreground">
          {internal ? "Only managers and engineers can see this" : "The requester can see this"}
        </span>
        <button type="submit" className={cn(btnPrimary, "ml-auto")} disabled={send.isPending || !body.trim()}>
          Send
        </button>
      </div>
    </form>
  )
}

function Hours({ requestId, lk, canLog }: { requestId: string; lk: Lookups; canLog: boolean }) {
  const qc = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const logs = useQuery({ queryKey: ["timelogs", requestId], queryFn: () => api.timelogs(requestId) })
  const assigns = useQuery({ queryKey: ["assignments", requestId], queryFn: () => api.assignments(requestId) })
  const [day, setDay] = useState(todayJakarta())
  const [hours, setHours] = useState("")
  const [note, setNote] = useState("")
  const add = useMutation({
    mutationFn: () => api.logHours(requestId, { work_date: day, hours, note: note || undefined }),
    onSuccess: () => {
      setHours("")
      setNote("")
      for (const k of ["timelogs", "assignments", "activity"]) qc.invalidateQueries({ queryKey: [k, requestId] })
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  const engineerOf: Record<string, string> = {}
  for (const a of assigns.data ?? []) engineerOf[a.id] = a.engineer_id
  return (
    <div className="flex flex-col gap-3">
      {canLog && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
          <label className="flex flex-col gap-1 text-xs">
            Date
            <input type="date" required max={todayJakarta()} className={inputCls} value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-xs">
            Hours
            <input type="number" required min="0.25" max="24" step="0.25" className={cn(inputCls, "w-24")} value={hours} onChange={(e) => setHours(e.target.value)} />
          </label>
          <label className="flex min-w-[200px] flex-1 flex-col gap-1 text-xs">
            Note
            <input maxLength={300} className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="submit" className={btnPrimary} disabled={add.isPending}><Clock className="size-4" aria-hidden /> Log hours</button>
        </form>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 font-medium">Date</th>
            <th className="py-2 font-medium">Engineer</th>
            <th className="py-2 text-right font-medium">Hours</th>
            <th className="py-2 pl-4 font-medium">Note</th>
          </tr>
        </thead>
        <tbody>
          {(logs.data ?? []).length === 0 && (
            <tr><td colSpan={4} className="py-4 text-muted-foreground">No hours logged yet.</td></tr>
          )}
          {(logs.data ?? []).map((l) => (
            <tr key={l.id} className="border-b last:border-0">
              <td className="py-2">{fmtDate(l.work_date)}</td>
              <td className="py-2">{personName(lk.personById, engineerOf[l.assignment_id], lk.me?.id)}</td>
              <td className="tabular py-2 text-right">{Number(l.hours)}</td>
              <td className="py-2 pl-4 text-muted-foreground">{l.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
