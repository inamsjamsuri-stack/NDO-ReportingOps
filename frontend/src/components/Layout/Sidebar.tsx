import { Link, useRouterState } from "@tanstack/react-router"
import {
  BookOpen,
  ChartLine,
  Inbox,
  KanbanSquare,
  LayoutDashboard,
  LogOut,
  Plus,
  Settings,
  ShieldCheck,
  User,
} from "lucide-react"
import type { ComponentType } from "react"

import { Logo } from "@/components/Common/Logo"
import useAuth from "@/hooks/useAuth"
import { useMe } from "@/hooks/useLookups"
import { initials, ROLE } from "@/lib/format"
import type { Role } from "@/lib/types"
import { cn } from "@/lib/utils"

interface NavItem {
  label: string
  to: string
  search?: Record<string, unknown>
  icon: ComponentType<{ className?: string }>
  roles?: Role[]
  match: (path: string, search: Record<string, unknown>) => boolean
}

const NAV: NavItem[] = [
  { label: "Dashboard", to: "/", icon: LayoutDashboard, match: (p) => p === "/" },
  {
    label: "Inbox",
    to: "/requests",
    icon: Inbox,
    match: (p, s) => p.startsWith("/requests") && s.view !== "board" && s.mine !== true,
  },
  {
    label: "Board",
    to: "/requests",
    search: { view: "board" },
    icon: KanbanSquare,
    match: (p, s) => p === "/requests" && s.view === "board",
  },
  {
    label: "My work",
    to: "/requests",
    search: { mine: true },
    icon: User,
    match: (p, s) => p === "/requests" && s.mine === true,
  },
  { label: "Report catalog", to: "/catalog", icon: BookOpen, match: (p) => p.startsWith("/catalog") },
  {
    label: "Workload",
    to: "/workload",
    icon: ChartLine,
    roles: ["manager", "admin"],
    match: (p) => p.startsWith("/workload"),
  },
  {
    label: "Admin",
    to: "/admin",
    icon: ShieldCheck,
    roles: ["admin"],
    match: (p) => p.startsWith("/admin"),
  },
]

export function Sidebar() {
  const { logout } = useAuth()
  const { data: me } = useMe()
  const location = useRouterState({ select: (s) => s.location })
  const search = location.search as Record<string, unknown>

  return (
    <nav
      aria-label="Main"
      className="flex shrink-0 grow basis-[232px] flex-col gap-0.5 bg-sidebar px-3 pb-4 text-sidebar-foreground md:sticky md:top-0 md:h-svh md:grow-0"
    >
      <div className="-mx-3 flex h-1">
        <span className="flex-1 bg-[#FFCB05]" />
        <span className="flex-1 bg-[#32BCAD]" />
        <span className="flex-1 bg-[#EC008C]" />
        <span className="flex-1 bg-[#ED1C24]" />
      </div>
      <div className="px-2.5 pb-4 pt-5">
        <Logo dark asLink />
        <p className="mt-1 text-xs text-[#B8B8BA]">IOH · Performance Reporting</p>
      </div>
      {me?.role !== "admin" && (
        <Link
          to="/requests/new"
          className="mb-3 flex h-10 items-center justify-center gap-2 rounded bg-primary text-sm font-semibold text-primary-foreground hover:bg-[#9E1271]"
        >
          <Plus className="size-4" aria-hidden /> New request
        </Link>
      )}
      {NAV.filter((n) => !n.roles || (me && n.roles.includes(me.role))).map((n) => {
        const active = n.match(location.pathname, search)
        return (
          <Link
            key={n.label}
            to={n.to}
            search={n.search ?? {}}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex min-h-9 items-center gap-2.5 rounded px-2.5 text-sm hover:bg-[#3A3A3C] hover:text-white",
              active && "bg-sidebar-accent font-semibold text-white shadow-[inset_3px_0_0_#FFCB05]",
            )}
          >
            <n.icon className="size-4" />
            {n.label}
          </Link>
        )
      })}
      <div className="grow" />
      <Link
        to="/settings"
        className="flex min-h-9 items-center gap-2.5 rounded px-2.5 text-sm hover:bg-[#3A3A3C] hover:text-white"
      >
        <Settings className="size-4" /> Settings
      </Link>
      <div className="mt-2 flex items-center gap-2.5 border-t border-sidebar-border px-2.5 pt-3">
        <span className="flex size-8 items-center justify-center rounded-full bg-[#FFCB05] text-xs font-semibold text-[#2D2D2D]">
          {initials(me?.full_name ?? me?.email)}
        </span>
        <div className="flex min-w-0 grow flex-col">
          <span className="truncate text-sm font-semibold text-white">{me?.full_name ?? me?.email}</span>
          <span className="text-xs text-[#B8B8BA]">{me ? ROLE[me.role] : ""}</span>
        </div>
        <button
          type="button"
          onClick={logout}
          aria-label="Log out"
          className="rounded p-2 hover:bg-[#3A3A3C] hover:text-white"
        >
          <LogOut className="size-4" />
        </button>
      </div>
    </nav>
  )
}
