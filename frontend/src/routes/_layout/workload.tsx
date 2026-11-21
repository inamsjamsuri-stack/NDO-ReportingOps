import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"

import { PageHeader, Tag } from "@/components/Common/Badges"
import { api } from "@/lib/api"

export const Route = createFileRoute("/_layout/workload")({
  component: WorkloadPage,
  head: () => ({ meta: [{ title: "Workload - ReportOps" }] }),
})

function WorkloadPage() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["workload"], queryFn: api.workload })
  const rows = data ?? []
  const max = Math.max(1, ...rows.map((r) => Number(r.remaining_estimated_hours)))
  return (
    <div>
      <PageHeader
        title="Workload"
        subtitle="Active requests per engineer and the estimated hours still to go. The full capacity view comes in Phase 2."
      />
      {isError && <p className="text-sm text-destructive">Only managers and admins can see workload.</p>}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/60">
            <tr className="text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2.5 font-medium">Engineer</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Active requests</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Remaining estimated hours</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Overdue</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} className="px-4 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">No engineers yet.</td></tr>
            )}
            {rows.map((r) => {
              const h = Number(r.remaining_estimated_hours)
              return (
                <tr key={r.engineer_id} className="border-t">
                  <td className="px-4 py-2.5 font-medium">{r.full_name ?? "—"}</td>
                  <td className="tabular px-3 py-2.5 text-right">{r.active_requests}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <div className="h-2.5 w-48 rounded-full bg-muted">
                        <div className="h-2.5 rounded-full bg-[#4D4D4F]" style={{ width: `${(h / max) * 100}%` }} />
                      </div>
                      <span className="tabular">{h} h</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {r.overdue_requests > 0 ? <Tag tone="bad">{r.overdue_requests} overdue</Tag> : <Tag tone="good">None</Tag>}
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
