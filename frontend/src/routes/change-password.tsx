import { useMutation, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"

import { AuthLayout } from "@/components/Common/AuthLayout"
import { isLoggedIn } from "@/hooks/useAuth"
import { api, errorMessage } from "@/lib/api"

export const Route = createFileRoute("/change-password")({
  component: ChangePassword,
  beforeLoad: async () => {
    if (!isLoggedIn()) throw redirect({ to: "/login" })
  },
  head: () => ({ meta: [{ title: "Change your password - ReportOps" }] }),
})

const inputCls =
  "h-10 w-full rounded border border-input bg-background px-3 text-sm focus:border-primary focus:outline-2 focus:outline-[#E68AC4]"

function ChangePassword() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [repeat, setRepeat] = useState("")
  const [error, setError] = useState("")
  const save = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["me"] })
      navigate({ to: "/" })
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError("")
    if (next !== repeat) {
      setError("The two new passwords are not the same.")
      return
    }
    save.mutate()
  }
  return (
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold">Choose your own password</h1>
          <p className="text-sm text-muted-foreground">
            Your account has a temporary password from the administrator. Please set a new one before you continue.
          </p>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Temporary password
          <input required type="password" className={inputCls} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          New password
          <input required type="password" minLength={8} className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          <span className="text-xs font-normal text-muted-foreground">At least 8 characters.</span>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Repeat new password
          <input required type="password" minLength={8} className={inputCls} value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={save.isPending}
          className="h-10 rounded bg-primary text-sm font-semibold text-primary-foreground hover:bg-[#9E1271] disabled:opacity-60">
          {save.isPending ? "Saving…" : "Save and continue"}
        </button>
      </form>
    </AuthLayout>
  )
}
