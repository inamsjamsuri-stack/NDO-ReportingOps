import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Bell } from "lucide-react"
import { useEffect, useRef, useState } from "react"

import { api } from "@/lib/api"
import { fmtDateTime } from "@/lib/format"

export function NotificationBell() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const { data } = useQuery({
    queryKey: ["notifications"],
    queryFn: api.notifications,
    refetchInterval: 60_000,
  })
  const readOne = useMutation({
    mutationFn: api.readNotification,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  })
  const readAll = useMutation({
    mutationFn: api.readAllNotifications,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  })

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", close)
    return () => document.removeEventListener("mousedown", close)
  }, [open])

  const unread = data?.unread ?? 0
  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="relative flex size-10 items-center justify-center rounded hover:bg-muted"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 min-w-4 rounded-full bg-primary px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-[360px] max-w-[90vw] rounded-md border bg-popover shadow-lg">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <span className="text-sm font-semibold">Notifications</span>
            <button
              type="button"
              className="text-sm text-primary hover:underline disabled:opacity-50"
              disabled={!unread || readAll.isPending}
              onClick={() => readAll.mutate()}
            >
              Mark all read
            </button>
          </div>
          <ul className="max-h-[420px] overflow-y-auto">
            {(data?.data ?? []).length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">No notifications yet</li>
            )}
            {(data?.data ?? []).map((n) => (
              <li key={n.id} className="border-b last:border-0">
                {n.request_id ? (
                  <Link
                    to="/requests/$requestId"
                    params={{ requestId: n.request_id }}
                    onClick={() => {
                      if (!n.read_at) readOne.mutate(n.id)
                      setOpen(false)
                    }}
                    className="flex gap-3 px-4 py-3 hover:bg-muted"
                  >
                    <Dot unread={!n.read_at} />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-sm">{n.title}</span>
                      <span className="text-xs text-muted-foreground">{fmtDateTime(n.created_at)}</span>
                    </span>
                  </Link>
                ) : (
                  <div className="flex gap-3 px-4 py-3">
                    <Dot unread={!n.read_at} />
                    <span className="text-sm">{n.title}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Dot({ unread }: { unread: boolean }) {
  return (
    <span
      aria-hidden
      className="mt-1.5 size-2 shrink-0 rounded-full"
      style={{ background: unread ? "#C6168D" : "transparent" }}
    />
  )
}
