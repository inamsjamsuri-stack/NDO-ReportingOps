import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { Search } from "lucide-react"
import { useEffect, useState } from "react"

import { PageHeader, PriorityLabel, SlaTag, StatusBadge } from "@/components/Common/Badges"
import { personName, useLookups } from "@/hooks/useLookups"
import { api, type RequestFilters } from "@/lib/api"
import { BOARD_COLUMNS, fmtDate, initials, OPEN_STATUSES, PRIORITY, STATUS } from "@/lib/format"
import type { Priority, RequestItem, Status } from "@/lib/types"
import { cn } from "@/lib/utils"

interface InboxSearch {
  view?: "table" | "board"
  q?: string
  status?: string
  priority?: string
  customer?: string
  domain?: string
  overdue?: boolean
  mine?: boolean
  all?: boolean
  sort?: string
  page?: number
}

export const Route = createFileRoute("/_layout/requests/")({
  component: InboxPage,
  validateSearch: (s: Record<string, unknown>): InboxSearch => ({
    view: s.view === "board" ? "board" : undefined,
    q: typeof s.q === "string" && s.q ? s.q : undefined,
    status: typeof s.status === "string" && s.status ? s.status : undefined,
    priority: typeof s.priority === "string" && s.priority ? s.priority : undefined,
    customer: typeof s.customer === "string" && s.customer ? s.customer : undefined,
    domain: typeof s.domain === "string" && s.domain ? s.domain : undefined,
    overdue: s.overdue === true || s.overdue === "true" ? true : undefined,
    mine: s.mine === true || s.mine === "true" ? true : undefined,
    all: s.all === true || s.all === "true" ? true : undefined,
    sort: typeof s.sort === "string" ? s.sort : undefined,
    page: typeof s.page === "number" && s.page > 1 ? s.page : undefined,
  }),
  head: () => ({ meta: [{ title: "Inbox - ReportOps" }] }),
})

const PAGE = 25
const selectCls = "h-9 rounded border border-input bg-background px-3 text-sm"

type Tab = { key: string; label: string; search: InboxSearch }
const TABS: Tab[] = [
  { key: "open", label: "All open", search: {} },
  { key: "mine", label: "My work", search: { mine: true } },
  { key: "overdue", label: "Overdue", search: { overdue: true } },
  { key: "hold", label: "On hold", search: { status: "on_hold" } },
  { key: "done", label: "Completed", search: { status: "completed" } },
  { key: "all", label: "All", search: { all: true } },
]

function activeTab(s: InboxSearch): string {
  if (s.mine) return "mine"
  if (s.overdue) return "overdue"
  if (s.status === "on_hold") return "hold"
  if (s.status === "completed") return "done"
  if (s.all) return "all"
  if (!s.status) return "open"
  return ""
}

function InboxPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const lk = useLookups()
  const board = search.view === "board"
  const [q, setQ] = useState(search.q ?? "")

  // Debounced search box.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? "") !== q) navigate({ search: (prev) => ({ ...prev, q: q || undefined, page: undefined }) })
    }, 350)
    return () => clearTimeout(t)
  }, [q, search.q, navigate])

  const statuses: string[] | undefined = search.status
    ? search.status.split(",")
    : search.all || search.overdue
      ? undefined
      : OPEN_STATUSES
  const filters: RequestFilters = {
    q: search.q,
    status: board && !search.status ? BOARD_COLUMNS : statuses,
    priority: search.priority ? [search.priority] : undefined,
    customer_id: search.customer,
    domain_id: search.domain,
    overdue: search.overdue,
    mine: search.mine,
    sort: search.sort ?? "committed_date",
    skip: board ? 0 : ((search.page ?? 1) - 1) * PAGE,
    limit: board ? 200 : PAGE,
  }
  const { data, isLoading, isError } = useQuery({ queryKey: ["requests", filters], queryFn: () => api.requests(filters) })
  const set = (patch: Partial<InboxSearch>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch, page: undefined }) })
  const tab = activeTab(search)
  const pages = Math.max(1, Math.ceil((data?.count ?? 0) / PAGE))

  return (
    <div>
      <PageHeader title={board ? "Board" : "Inbox"}>
        <div role="group" aria-label="View" className="inline-flex overflow-hidden rounded border">
          <Link
            to="/requests"
            search={{ ...search, view: undefined }}
            aria-current={!board ? "page" : undefined}
            className={cn("flex h-9 items-center px-3 text-sm", !board ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-muted")}
          >
            Table
          </Link>
          <Link
            to="/requests"
            search={{ ...search, view: "board", page: undefined }}
            aria-current={board ? "page" : undefined}
            className={cn("flex h-9 items-center border-l px-3 text-sm", board ? "bg-accent font-semibold text-accent-foreground" : "hover:bg-muted")}
          >
            Board
          </Link>
        </div>
      </PageHeader>

      {!board && (
        <div className="mb-4 flex flex-wrap gap-5 border-b">
          {TABS.map((t) => (
            <Link
              key={t.key}
              to="/requests"
              search={t.search}
              className={cn(
                "-mb-px flex h-9 items-center border-b-2 px-1 text-sm",
                tab === t.key ? "border-primary font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </Link>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-[240px] max-w-[360px] flex-1 items-center gap-2 rounded border border-input px-3">
          <Search className="size-4 text-muted-foreground" aria-hidden />
          <span className="sr-only">Search requests</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search ID, title, report…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <label className="sr-only" htmlFor="i-cust">Customer</label>
        <select id="i-cust" className={selectCls} value={search.customer ?? ""} onChange={(e) => set({ customer: e.target.value || undefined })}>
          <option value="">All customers</option>
          {lk.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="i-domain">Domain</label>
        <select id="i-domain" className={selectCls} value={search.domain ?? ""} onChange={(e) => set({ domain: e.target.value || undefined })}>
          <option value="">All domains</option>
          {lk.domains.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="sr-only" htmlFor="i-prio">Priority</label>
        <select id="i-prio" className={selectCls} value={search.priority ?? ""} onChange={(e) => set({ priority: e.target.value || undefined })}>
          <option value="">All priorities</option>
          {(Object.keys(PRIORITY) as Priority[]).map((p) => <option key={p} value={p}>{PRIORITY[p].label}</option>)}
        </select>
        {!board && (
          <>
            <label className="sr-only" htmlFor="i-sort">Sort</label>
            <select id="i-sort" className={selectCls} value={search.sort ?? "committed_date"} onChange={(e) => set({ sort: e.target.value })}>
              <option value="committed_date">Sort: committed date</option>
              <option value="priority">Sort: priority</option>
              <option value="newest">Sort: newest</option>
              <option value="oldest">Sort: oldest</option>
            </select>
          </>
        )}
      </div>

      {isError && <p className="text-sm text-destructive">Could not load requests.</p>}
      {board ? (
        <Board rows={data?.data ?? []} lk={lk} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/60">
                <tr className="text-left text-xs text-muted-foreground">
                  {["ID", "Title", "Customer", "Domain", "Priority", "Status", "Primary engineer", "Committed", "SLA"].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={9} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {!isLoading && (data?.data ?? []).length === 0 && (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">No requests match these filters.</td></tr>
                )}
                {data?.data.map((r) => <Row key={r.id} r={r} lk={lk} />)}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>{data ? `${data.count} request${data.count === 1 ? "" : "s"}` : ""}</span>
            <span className="flex items-center gap-2">
              <button
                type="button"
                className="rounded border px-3 py-1 disabled:opacity-40"
                disabled={(search.page ?? 1) <= 1}
                onClick={() => navigate({ search: (p) => ({ ...p, page: (p.page ?? 1) - 1 }) })}
              >
                Previous
              </button>
              Page {search.page ?? 1} of {pages}
              <button
                type="button"
                className="rounded border px-3 py-1 disabled:opacity-40"
                disabled={(search.page ?? 1) >= pages}
                onClick={() => navigate({ search: (p) => ({ ...p, page: (p.page ?? 1) + 1 }) })}
              >
                Next
              </button>
            </span>
          </div>
        </>
      )}
    </div>
  )
}

type Lookups = ReturnType<typeof useLookups>

function Row({ r, lk }: { r: RequestItem; lk: Lookups }) {
  return (
    <tr className="border-t hover:bg-muted/40">
      <td className="tabular whitespace-nowrap px-3 py-2.5 text-muted-foreground">{r.code}</td>
      <td className="max-w-[340px] truncate px-3 py-2.5">
        <Link to="/requests/$requestId" params={{ requestId: r.id }} className="font-medium hover:underline">
          {r.title}
        </Link>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">{lk.customerById[r.customer_id]?.name ?? "—"}</td>
      <td className="whitespace-nowrap px-3 py-2.5">{lk.domainById[r.domain_id]?.name ?? "—"}</td>
      <td className="px-3 py-2.5"><PriorityLabel priority={r.priority} /></td>
      <td className="px-3 py-2.5"><StatusBadge status={r.status} /></td>
      <td className="whitespace-nowrap px-3 py-2.5"><PrimaryEngineer requestId={r.id} status={r.status} lk={lk} /></td>
      <td className="tabular whitespace-nowrap px-3 py-2.5">{fmtDate(r.committed_date)}</td>
      <td className="px-3 py-2.5"><SlaTag status={r.status} committed={r.committed_date} isOverdue={r.is_overdue} /></td>
    </tr>
  )
}

/** Primary engineer, loaded per row only for statuses that have one. */
function PrimaryEngineer({ requestId, status, lk }: { requestId: string; status: Status; lk: Lookups }) {
  const hasTeam = !["submitted", "under_assessment", "rejected", "cancelled"].includes(status)
  const { data } = useQuery({
    queryKey: ["assignments", requestId],
    queryFn: () => api.assignments(requestId),
    enabled: hasTeam,
    staleTime: 60_000,
  })
  const primary = data?.find((a) => a.assignment_role === "primary")
  return <>{primary ? personName(lk.personById, primary.engineer_id, lk.me?.id) : "—"}</>
}

function Board({ rows, lk }: { rows: RequestItem[]; lk: Lookups }) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max items-start gap-3">
        {BOARD_COLUMNS.map((col) => {
          const cards = rows.filter((r) => r.status === col)
          return (
            <section key={col} className="flex w-[264px] shrink-0 flex-col gap-2 rounded-md bg-muted p-2.5">
              <div className="flex items-center gap-2 px-1 pb-1">
                <span aria-hidden className="size-2.5 rounded-full" style={{ background: STATUS[col].dot }} />
                <h2 className="text-sm font-semibold">{STATUS[col].label}</h2>
                <span className="text-xs text-muted-foreground">{cards.length}</span>
              </div>
              {cards.length === 0 && <p className="px-1 py-3 text-xs text-muted-foreground">Nothing here</p>}
              {cards.map((r) => (
                <Link
                  key={r.id}
                  to="/requests/$requestId"
                  params={{ requestId: r.id }}
                  className="flex flex-col gap-2 rounded-md border bg-card p-3 hover:border-[#E68AC4]"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="tabular text-muted-foreground">{r.code}</span>
                    <PriorityLabel priority={r.priority} />
                  </div>
                  <span className="text-sm font-medium leading-snug">{r.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {lk.customerById[r.customer_id]?.name ?? "—"} · {lk.domainById[r.domain_id]?.name ?? "—"}
                  </span>
                  <div className="flex items-center justify-between">
                    <SlaTag status={r.status} committed={r.committed_date} isOverdue={r.is_overdue} />
                    <span
                      title={personName(lk.personById, r.requester_id, lk.me?.id)}
                      className="flex size-6 items-center justify-center rounded-full bg-[#F0F0F0] text-[10px] font-semibold"
                    >
                      {initials(lk.personById[r.requester_id]?.full_name)}
                    </span>
                  </div>
                </Link>
              ))}
            </section>
          )
        })}
        <section className="flex w-[200px] shrink-0 flex-col gap-1.5 rounded-md border border-dashed p-3.5">
          <h2 className="text-sm font-semibold text-[#0F6B61]">Completed</h2>
          <span className="text-xs text-muted-foreground">
            Hidden on the board. Open the{" "}
            <Link to="/requests" search={{ status: "completed" }} className="text-primary hover:underline">
              Completed tab
            </Link>
            .
          </span>
        </section>
      </div>
    </div>
  )
}
