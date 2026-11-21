import { createFileRoute, Outlet, redirect, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { NotificationBell } from "@/components/Layout/NotificationBell"
import { Sidebar } from "@/components/Layout/Sidebar"
import { isLoggedIn } from "@/hooks/useAuth"
import { useMe } from "@/hooks/useLookups"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({
        to: "/login",
      })
    }
  },
})

function Layout() {
  const { data: me } = useMe()
  const navigate = useNavigate()
  // A temporary password set by an admin must be changed before anything else.
  useEffect(() => {
    if (me?.must_change_password) navigate({ to: "/change-password" })
  }, [me, navigate])

  return (
    <div className="flex min-h-svh w-full flex-wrap bg-background">
      <Sidebar />
      <div className="flex min-w-0 grow-[999] basis-[560px] flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-end gap-2 border-b bg-background/95 px-6 backdrop-blur">
          <NotificationBell />
        </header>
        <main className="flex-1 px-6 pb-12 pt-6 md:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
