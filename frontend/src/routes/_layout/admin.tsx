import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { type FormEvent, useEffect, useState } from "react"

import { PageHeader, Tag } from "@/components/Common/Badges"
import useCustomToast from "@/hooks/useCustomToast"
import { useLookups } from "@/hooks/useLookups"
import { api, errorMessage, type MasterKind } from "@/lib/api"
import { CATEGORY, fmtDate, fmtHours, PRIORITY, ROLE } from "@/lib/format"
import type { CalendarSettings, Category, Holiday, Me, Priority, Role, SlaPolicy } from "@/lib/types"
import { cn } from "@/lib/utils"

export const Route = createFileRoute("/_layout/admin")({
  component: AdminPage,
  beforeLoad: async () => {
    const me = await api.me()
    if (me.role !== "admin") throw redirect({ to: "/" })
  },
  head: () => ({ meta: [{ title: "Admin - ReportOps" }] }),
})

const inputCls = "h-9 w-full rounded border border-input bg-background px-3 text-sm"
const btn = "inline-flex h-9 items-center rounded border px-3.5 text-sm font-medium disabled:opacity-50"
const btnPrimary = `${btn} border-primary bg-primary text-primary-foreground hover:bg-[#9E1271]`

const TABS = [
  { key: "users", label: "Users" },
  { key: "master", label: "Master data" },
  { key: "sla", label: "SLA policies" },
  { key: "calendar", label: "Holidays & hours" },
] as const
type TabKey = (typeof TABS)[number]["key"]

function AdminPage() {
  const [tab, setTab] = useState<TabKey>("users")
  return (
    <div>
      <PageHeader title="Admin" subtitle="Users, master data, SLA policies and the working calendar" />
      <div className="mb-5 flex flex-wrap gap-5 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              "-mb-px h-9 border-b-2 px-1 text-sm",
              tab === t.key ? "border-primary font-semibold" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "users" && <UsersTab />}
      {tab === "master" && <MasterTab />}
      {tab === "sla" && <SlaTab />}
      {tab === "calendar" && <CalendarTab />}
    </div>
  )
}

// -- Users --------------------------------------------------------------------

function UsersTab() {
  const qc = useQueryClient()
  const lk = useLookups()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const { data } = useQuery({ queryKey: ["users"], queryFn: api.users })
  const [editing, setEditing] = useState<Me | "new" | null>(null)
  const deactivate = useMutation({
    mutationFn: api.deactivateUser,
    onSuccess: () => {
      showSuccessToast("User deactivated")
      qc.invalidateQueries({ queryKey: ["users"] })
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  const pending = (data?.data ?? []).filter((u) => u.approval_status === "pending")
  return (
    <div className="flex flex-col gap-4">
      {pending.length > 0 && <PendingRequests users={pending} />}
      <div>
        <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>Add user</button>
      </div>
      {editing && <UserForm user={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr className="text-left text-xs text-muted-foreground">
              {["Name", "Email", "Role", "Customer / department", "Status", ""].map((h) => (
                <th key={h} scope="col" className="px-3 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(data?.data ?? []).filter((u) => u.approval_status !== "pending").map((u) => (
              <tr key={u.id} className="border-t">
                <td className="px-3 py-2.5 font-medium">{u.full_name ?? "—"}</td>
                <td className="px-3 py-2.5">{u.email}</td>
                <td className="px-3 py-2.5">{ROLE[u.role]}</td>
                <td className="px-3 py-2.5">{u.customer_id ? lk.customerById[u.customer_id]?.name ?? "—" : "—"}</td>
                <td className="px-3 py-2.5">
                  {u.approval_status === "rejected" ? <Tag tone="bad">Rejected</Tag> : u.is_active ? <Tag tone="good">Active</Tag> : <Tag>Inactive</Tag>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <button type="button" className="text-primary hover:underline" onClick={() => setEditing(u)}>Edit</button>
                  {u.is_active && u.id !== lk.me?.id && (
                    <button
                      type="button"
                      className="ml-4 text-muted-foreground hover:text-destructive"
                      onClick={() => {
                        if (window.confirm(`Deactivate ${u.full_name ?? u.email}? Their history stays.`)) deactivate.mutate(u.id)
                      }}
                    >
                      Deactivate
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PendingRequests({ users }: { users: Me[] }) {
  const qc = useQueryClient()
  const lk = useLookups()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [roles, setRoles] = useState<Record<string, Role>>({})
  const done = (msg: string) => {
    showSuccessToast(msg)
    qc.invalidateQueries({ queryKey: ["users"] })
    qc.invalidateQueries({ queryKey: ["directory"] })
  }
  const approve = useMutation({
    mutationFn: (u: Me) => api.approveUser(u.id, { role: roles[u.id] ?? "requester", customer_id: u.customer_id }),
    onSuccess: (u) => done(`${u.full_name ?? u.email} can now log in`),
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  const reject = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.rejectUser(id, reason),
    onSuccess: () => done("Request rejected"),
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  return (
    <section className="rounded-md border border-[#FFE27A] bg-[#FFFBEA] p-4">
      <h2 className="mb-3 text-[15px] font-semibold">Account requests waiting for approval ({users.length})</h2>
      <ul className="flex flex-col divide-y divide-[#FFE27A]">
        {users.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="flex min-w-[240px] flex-1 flex-col">
              <span className="text-sm font-semibold">{u.full_name} · <span className="font-normal">{u.email}</span></span>
              <span className="text-xs text-muted-foreground">
                {u.customer_id ? lk.customerById[u.customer_id]?.name ?? "—" : "—"} · asked {fmtDate(u.created_at ?? null)}
              </span>
              {u.registration_note && <span className="mt-1 text-sm">“{u.registration_note}”</span>}
            </div>
            <label className="flex items-center gap-2 text-xs">
              Role
              <select className={cn(inputCls, "w-36")} value={roles[u.id] ?? "requester"}
                onChange={(e) => setRoles({ ...roles, [u.id]: e.target.value as Role })}>
                {(Object.keys(ROLE) as Role[]).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
              </select>
            </label>
            <button type="button" className={btnPrimary} disabled={approve.isPending} onClick={() => approve.mutate(u)}>Approve</button>
            <button
              type="button"
              className={btn}
              disabled={reject.isPending}
              onClick={() => {
                const reason = window.prompt(`Why is ${u.full_name}'s request rejected? They will see this.`)
                if (reason && reason.trim().length >= 3) reject.mutate({ id: u.id, reason: reason.trim() })
              }}
            >
              Reject
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

function UserForm({ user, onDone }: { user: Me | null; onDone: () => void }) {
  const qc = useQueryClient()
  const lk = useLookups()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const [email, setEmail] = useState(user?.email ?? "")
  const [name, setName] = useState(user?.full_name ?? "")
  const [role, setRole] = useState<Role>(user?.role ?? "requester")
  const [customer, setCustomer] = useState(user?.customer_id ?? "")
  const [password, setPassword] = useState("")
  const [active, setActive] = useState(user?.is_active ?? true)
  const save = useMutation({
    mutationFn: () => {
      const body = {
        email,
        full_name: name,
        role,
        customer_id: customer || null,
        is_active: active,
        ...(password ? { password } : {}),
      }
      return user ? api.updateUser(user.id, body) : api.createUser(body)
    },
    onSuccess: () => {
      showSuccessToast("User saved")
      qc.invalidateQueries({ queryKey: ["users"] })
      qc.invalidateQueries({ queryKey: ["directory"] })
      qc.invalidateQueries({ queryKey: ["engineers"] })
      onDone()
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  return (
    <form
      className="grid gap-3 rounded-md border bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <h2 className="text-sm font-semibold sm:col-span-2 lg:col-span-3">{user ? "Edit user" : "Add user"}</h2>
      <label className="flex flex-col gap-1 text-xs">
        Full name
        <input required className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Email (login)
        <input required type="email" autoComplete="off" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Role
        <select className={inputCls} value={role} onChange={(e) => setRole(e.target.value as Role)}>
          {(Object.keys(ROLE) as Role[]).map((r) => <option key={r} value={r}>{ROLE[r]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Customer / department {role === "requester" && <span className="text-destructive">(required for requesters)</span>}
        <select required={role === "requester"} className={inputCls} value={customer} onChange={(e) => setCustomer(e.target.value)}>
          <option value="">None</option>
          {lk.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {lk.customers.length === 0 && (
          <span className="text-[#7A5A00]">No customers yet. Add them first in the Master data tab.</span>
        )}
      </label>
      <label className="flex flex-col gap-1 text-xs">
        {user ? "Temporary password (leave empty to keep)" : "Temporary password (optional)"}
        <input type="password" minLength={8} autoComplete="new-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} />
        <span className="text-muted-foreground">
          {user
            ? "The user must change it at next login."
            : "Leave empty to email the user a link to set their own password. If you set one, they must change it at first login."}
        </span>
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
      </label>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-3">
        <button type="submit" className={btnPrimary} disabled={save.isPending}>Save</button>
        <button type="button" className={btn} onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}

// -- Master data ----------------------------------------------------------------

const MASTER: { kind: MasterKind; label: string }[] = [
  { kind: "customers", label: "Customers / departments" },
  { kind: "domains", label: "Domains" },
  { kind: "request-types", label: "Request types" },
  { kind: "data-sources", label: "Data sources" },
]

function MasterTab() {
  const [kind, setKind] = useState<MasterKind>("customers")
  const qc = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const { data } = useQuery({ queryKey: ["master-admin", kind], queryFn: () => api.master(kind, true) })
  const [name, setName] = useState("")
  const [code, setCode] = useState("")
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["master-admin", kind] })
    qc.invalidateQueries({ queryKey: ["master", kind] })
    qc.invalidateQueries({ queryKey: ["signup-options"] })
  }
  const add = useMutation({
    mutationFn: () =>
      api.createMaster(kind, {
        name: name.trim(),
        sort_order: (data?.length ?? 0) + 1,
        is_active: true,
        ...(kind === "customers" ? { code: code || null, kind: "internal" as const } : {}),
      }),
    onSuccess: () => {
      setName("")
      setCode("")
      invalidate()
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  const toggle = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) => api.updateMaster(kind, id, { is_active }),
    onSuccess: invalidate,
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  return (
    <div className="flex flex-wrap items-start gap-6">
      <div className="flex w-56 flex-col gap-1">
        {MASTER.map((m) => (
          <button
            key={m.kind}
            type="button"
            onClick={() => setKind(m.kind)}
            className={cn("rounded px-3 py-2 text-left text-sm", kind === m.kind ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-muted")}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex min-w-[320px] flex-1 flex-col gap-3">
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add.mutate() }}>
          <label className="sr-only" htmlFor="m-name">Name</label>
          <input id="m-name" placeholder="New entry name" className={cn(inputCls, "max-w-xs")} value={name} onChange={(e) => setName(e.target.value)} />
          {kind === "customers" && (
            <>
              <label className="sr-only" htmlFor="m-code">Short code</label>
              <input id="m-code" placeholder="Short code" className={cn(inputCls, "w-32")} value={code} onChange={(e) => setCode(e.target.value)} />
            </>
          )}
          <button type="submit" className={btnPrimary} disabled={add.isPending}>Add</button>
        </form>
        <ul className="divide-y rounded-md border">
          {(data ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className={cn(!m.is_active && "text-muted-foreground line-through")}>
                {m.name} {m.code && <span className="text-muted-foreground">({m.code})</span>}
              </span>
              <button type="button" className="text-primary hover:underline" onClick={() => toggle.mutate({ id: m.id, is_active: !m.is_active })}>
                {m.is_active ? "Hide" : "Show again"}
              </button>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Entries are never deleted, only hidden, so old requests keep their names.</p>
      </div>
    </div>
  )
}

// -- SLA ------------------------------------------------------------------------

type PolicyDraft = Omit<SlaPolicy, "id">

function SlaTab() {
  const qc = useQueryClient()
  const lk = useLookups()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const { data } = useQuery({ queryKey: ["sla-policies"], queryFn: api.slaPolicies })
  const [editing, setEditing] = useState<SlaPolicy | "new" | null>(null)
  const recalc = useMutation({
    mutationFn: api.recalculateSla,
    onSuccess: (r) => showSuccessToast(r.message),
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  const order: Priority[] = ["critical", "high", "medium", "low"]
  const rows = [...(data ?? [])].sort((a, b) => order.indexOf(a.priority) - order.indexOf(b.priority))
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btnPrimary} onClick={() => setEditing("new")}>Add policy</button>
        <button type="button" className={btn} disabled={recalc.isPending} onClick={() => recalc.mutate()}>
          Recalculate open requests
        </button>
      </div>
      <p className="text-sm text-muted-foreground">
        Targets are in working time (8 working hours = 1 working day). The most specific matching policy wins; each priority needs one policy with category and request type set to “Any”.
      </p>
      {editing && (
        <PolicyForm
          policy={editing === "new" ? null : editing}
          onDone={() => {
            setEditing(null)
            qc.invalidateQueries({ queryKey: ["sla-policies"] })
          }}
        />
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr className="text-left text-xs text-muted-foreground">
              {["Name", "Priority", "Category", "Request type", "Response", "Resolution", "Status", ""].map((h) => (
                <th key={h} scope="col" className="px-3 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2.5 font-medium">{p.name}</td>
                <td className="px-3 py-2.5">{PRIORITY[p.priority].label}</td>
                <td className="px-3 py-2.5">{p.category ? CATEGORY[p.category] : "Any"}</td>
                <td className="px-3 py-2.5">{p.request_type_id ? lk.typeById[p.request_type_id]?.name ?? "—" : "Any"}</td>
                <td className="tabular px-3 py-2.5">{fmtHours(p.response_target_min)}</td>
                <td className="tabular px-3 py-2.5">{fmtHours(p.resolution_target_min)}</td>
                <td className="px-3 py-2.5">{p.is_active ? <Tag tone="good">Active</Tag> : <Tag>Off</Tag>}</td>
                <td className="px-3 py-2.5 text-right">
                  <button type="button" className="text-primary hover:underline" onClick={() => setEditing(p)}>Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PolicyForm({ policy, onDone }: { policy: SlaPolicy | null; onDone: () => void }) {
  const lk = useLookups()
  const { showErrorToast } = useCustomToast()
  const [d, setD] = useState<PolicyDraft>(
    policy ?? {
      name: "",
      priority: "medium",
      category: null,
      request_type_id: null,
      response_target_min: 480,
      resolution_target_min: 2400,
      calendar: "working",
      is_active: true,
    },
  )
  const save = useMutation({
    mutationFn: () => (policy ? api.updateSlaPolicy(policy.id, d) : api.createSlaPolicy(d)),
    onSuccess: onDone,
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  const set = (patch: Partial<PolicyDraft>) => setD({ ...d, ...patch })
  return (
    <form
      className="grid gap-3 rounded-md border bg-muted/40 p-4 sm:grid-cols-2 lg:grid-cols-4"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <label className="flex flex-col gap-1 text-xs sm:col-span-2">
        Name
        <input required className={inputCls} value={d.name} onChange={(e) => set({ name: e.target.value })} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Priority
        <select className={inputCls} value={d.priority} onChange={(e) => set({ priority: e.target.value as Priority })}>
          {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Category
        <select className={inputCls} value={d.category ?? ""} onChange={(e) => set({ category: (e.target.value || null) as Category | null })}>
          <option value="">Any</option>
          <option value="regular">Regular</option>
          <option value="ad_hoc">Ad hoc</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Request type
        <select className={inputCls} value={d.request_type_id ?? ""} onChange={(e) => set({ request_type_id: e.target.value || null })}>
          <option value="">Any</option>
          {lk.requestTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Response target (working hours)
        <input required type="number" min="0.25" step="0.25" className={inputCls}
          value={d.response_target_min / 60} onChange={(e) => set({ response_target_min: Math.round(Number(e.target.value) * 60) })} />
      </label>
      <label className="flex flex-col gap-1 text-xs">
        Resolution target (working hours)
        <input required type="number" min="0.25" step="0.25" className={inputCls}
          value={d.resolution_target_min / 60} onChange={(e) => set({ resolution_target_min: Math.round(Number(e.target.value) * 60) })} />
      </label>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input type="checkbox" checked={d.is_active} onChange={(e) => set({ is_active: e.target.checked })} /> Active
      </label>
      <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
        <button type="submit" className={btnPrimary} disabled={save.isPending}>Save</button>
        <button type="button" className={btn} onClick={onDone}>Cancel</button>
      </div>
    </form>
  )
}

// -- Calendar ---------------------------------------------------------------------

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

function CalendarTab() {
  const qc = useQueryClient()
  const { showErrorToast, showSuccessToast } = useCustomToast()
  const year = new Date().getFullYear()
  const [y, setY] = useState(year)
  const holidays = useQuery({ queryKey: ["holidays", y], queryFn: () => api.holidays(y) })
  const cal = useQuery({ queryKey: ["calendar"], queryFn: api.calendar })
  const [c, setC] = useState<CalendarSettings | null>(null)
  useEffect(() => {
    if (cal.data && !c) setC(cal.data)
  }, [cal.data, c])
  const [day, setDay] = useState("")
  const [name, setName] = useState("")
  const [kind, setKind] = useState<Holiday["kind"]>("national")

  const add = useMutation({
    mutationFn: () => api.addHoliday({ day, name, kind }),
    onSuccess: () => {
      setDay("")
      setName("")
      qc.invalidateQueries({ queryKey: ["holidays"] })
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: api.removeHoliday,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["holidays"] }),
    onError: (e) => showErrorToast(errorMessage(e)),
  })
  const saveCal = useMutation({
    mutationFn: () => api.saveCalendar(c as CalendarSettings),
    onSuccess: () => {
      showSuccessToast("Working hours saved. Use “Recalculate open requests” on the SLA tab to apply them.")
      qc.invalidateQueries({ queryKey: ["calendar"] })
    },
    onError: (e) => showErrorToast(errorMessage(e)),
  })

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold">Holidays</h2>
          <label className="flex items-center gap-2 text-sm">
            Year
            <select className={cn(inputCls, "w-24")} value={y} onChange={(e) => setY(Number(e.target.value))}>
              {[year - 1, year, year + 1].map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </label>
        </div>
        <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); add.mutate() }}>
          <label className="sr-only" htmlFor="h-day">Date</label>
          <input id="h-day" required type="date" className={cn(inputCls, "w-40")} value={day} onChange={(e) => setDay(e.target.value)} />
          <label className="sr-only" htmlFor="h-name">Name</label>
          <input id="h-name" required placeholder="Holiday name" className={cn(inputCls, "min-w-[160px] flex-1")} value={name} onChange={(e) => setName(e.target.value)} />
          <label className="sr-only" htmlFor="h-kind">Kind</label>
          <select id="h-kind" className={cn(inputCls, "w-40")} value={kind} onChange={(e) => setKind(e.target.value as Holiday["kind"])}>
            <option value="national">National holiday</option>
            <option value="cuti_bersama">Cuti bersama</option>
            <option value="company">Company</option>
          </select>
          <button type="submit" className={btnPrimary} disabled={add.isPending}>Add</button>
        </form>
        <ul className="divide-y rounded-md border">
          {(holidays.data ?? []).length === 0 && <li className="px-4 py-4 text-sm text-muted-foreground">No holidays for {y} yet.</li>}
          {(holidays.data ?? []).map((h) => (
            <li key={h.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span><span className="tabular inline-block w-28">{fmtDate(h.day)}</span>{h.name}</span>
              <span className="flex items-center gap-3">
                <Tag>{h.kind === "cuti_bersama" ? "Cuti bersama" : h.kind === "company" ? "Company" : "National"}</Tag>
                <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => remove.mutate(h.id)}>Remove</button>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-[15px] font-semibold">Working hours</h2>
        {c && (
          <form className="flex flex-col gap-3 rounded-md border p-4" onSubmit={(e) => { e.preventDefault(); saveCal.mutate() }}>
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-1 text-xs">Working days</legend>
              {DAYS.map((label, i) => (
                <label key={label} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={c.work_days.includes(i)}
                    onChange={(e) =>
                      setC({ ...c, work_days: e.target.checked ? [...c.work_days, i].sort() : c.work_days.filter((x) => x !== i) })
                    }
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <TimeField label="Work starts" value={c.work_start} onChange={(v) => setC({ ...c, work_start: v })} />
              <TimeField label="Work ends" value={c.work_end} onChange={(v) => setC({ ...c, work_end: v })} />
              <TimeField label="Break starts" value={c.break_start ?? ""} onChange={(v) => setC({ ...c, break_start: v || null })} />
              <TimeField label="Break ends" value={c.break_end ?? ""} onChange={(v) => setC({ ...c, break_end: v || null })} />
            </div>
            <p className="text-xs text-muted-foreground">Time zone: {c.timezone}</p>
            <div>
              <button type="submit" className={btnPrimary} disabled={saveCal.isPending}>Save working hours</button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      {label}
      <input type="time" className={inputCls} value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}
