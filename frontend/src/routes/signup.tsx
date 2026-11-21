import { useMutation, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, redirect } from "@tanstack/react-router"
import { type FormEvent, useState } from "react"

import { AuthLayout } from "@/components/Common/AuthLayout"
import { isLoggedIn } from "@/hooks/useAuth"
import { api, errorMessage } from "@/lib/api"

export const Route = createFileRoute("/signup")({
  component: SignUp,
  beforeLoad: async () => {
    if (isLoggedIn()) throw redirect({ to: "/" })
  },
  head: () => ({ meta: [{ title: "Request an account - ReportOps" }] }),
})

const inputCls =
  "h-10 w-full rounded border border-input bg-background px-3 text-sm focus:border-primary focus:outline-2 focus:outline-[#E68AC4]"

function SignUp() {
  const opts = useQuery({ queryKey: ["signup-options"], queryFn: api.signupOptions })
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [customer, setCustomer] = useState("")
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const send = useMutation({
    mutationFn: () =>
      api.signup({ email: email.trim(), password, full_name: name.trim(), customer_id: customer, reason: reason.trim() || undefined }),
    onError: (e) => setError(errorMessage(e)),
  })

  const domains = opts.data?.allowed_domains ?? []
  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError("")
    if (password !== confirm) {
      setError("The two passwords are not the same.")
      return
    }
    if (domains.length && !domains.includes(email.trim().toLowerCase().split("@")[1] ?? "")) {
      setError(`Use your work email (${domains.map((d) => `@${d}`).join(", ")}).`)
      return
    }
    send.mutate()
  }

  if (send.isSuccess) {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-2xl font-bold">Request sent</h1>
          <p className="text-sm text-muted-foreground">
            The ReportOps administrator will check your request. You can log in once it is approved,
            and you will get an email when that happens.
          </p>
          <Link to="/login" className="text-sm text-primary underline underline-offset-4">Back to log in</Link>
        </div>
      </AuthLayout>
    )
  }

  if (opts.data && !opts.data.enabled) {
    return (
      <AuthLayout>
        <div className="flex flex-col gap-4 text-center">
          <h1 className="text-2xl font-bold">Request an account</h1>
          <p className="text-sm text-muted-foreground">Sign-up is switched off. Please ask the ReportOps administrator for an account.</p>
          <Link to="/login" className="text-sm text-primary underline underline-offset-4">Back to log in</Link>
        </div>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-2xl font-bold">Request an account</h1>
          <p className="text-sm text-muted-foreground">For people who send reporting requests. An administrator approves each account.</p>
        </div>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Full name
          <input required minLength={2} className={inputCls} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Work email
          <input required type="email" className={inputCls} value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email"
            placeholder={domains[0] ? `name@${domains[0]}` : "name@company.com"} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Customer / department
          <select required className={inputCls} value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="" disabled>Choose…</option>
            {(opts.data?.customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Why do you need access? <span className="font-normal text-muted-foreground">(optional)</span>
          <textarea rows={2} maxLength={500} className={`${inputCls} h-auto py-2`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Password
          <input required type="password" minLength={8} className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Repeat password
          <input required type="password" minLength={8} className={inputCls} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </label>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <button type="submit" disabled={send.isPending}
          className="h-10 rounded bg-primary text-sm font-semibold text-primary-foreground hover:bg-[#9E1271] disabled:opacity-60">
          {send.isPending ? "Sending…" : "Send request"}
        </button>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account? <Link to="/login" className="text-primary underline underline-offset-4">Log in</Link>
        </p>
      </form>
    </AuthLayout>
  )
}
