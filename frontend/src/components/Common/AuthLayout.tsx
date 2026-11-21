interface AuthLayoutProps {
  children: React.ReactNode
}

const POINTS = [
  { color: "#FFCB05", text: "Submit a request and follow it step by step" },
  { color: "#32BCAD", text: "See the committed date and SLA at any time" },
  { color: "#EC008C", text: "Talk to the team in one thread per request" },
]

/** Login, sign-up and password pages: IOH dark panel on the left, form on the right. */
export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="flex min-h-svh w-full flex-wrap">
      <aside className="flex min-h-[320px] shrink-0 grow basis-[420px] flex-col justify-between bg-[#2D2D2D] px-14 pb-10 text-white lg:min-h-svh lg:grow-0">
        <div className="-mx-14 flex h-1">
          <span className="flex-1 bg-[#FFCB05]" />
          <span className="flex-1 bg-[#32BCAD]" />
          <span className="flex-1 bg-[#EC008C]" />
          <span className="flex-1 bg-[#ED1C24]" />
        </div>
        <div className="flex max-w-[440px] flex-col gap-5 py-10">
          <div className="flex flex-col gap-1.5">
            <span className="flex h-[5px] w-[72px] overflow-hidden rounded-sm">
              <span className="flex-1 bg-[#FFCB05]" />
              <span className="flex-1 bg-[#32BCAD]" />
              <span className="flex-1 bg-[#EC008C]" />
              <span className="flex-1 bg-[#ED1C24]" />
            </span>
            <span className="text-[34px] font-semibold tracking-wide">ReportOps</span>
          </div>
          <p className="text-xl leading-snug text-[#E6E6E8]">
            One place to send, track and deliver every reporting request.
          </p>
          <ul className="flex flex-col gap-3 text-[15px] text-[#C8C8CA]">
            {POINTS.map((p) => (
              <li key={p.text} className="flex items-center gap-2.5">
                <span aria-hidden className="size-2 rounded-full" style={{ background: p.color }} />
                {p.text}
              </li>
            ))}
          </ul>
        </div>
        <span className="text-[13px] text-[#A8A8AA]">IOH MS-NDO · Performance Reporting</span>
      </aside>
      <main className="flex grow-[999] basis-[480px] items-center justify-center px-6 py-12">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  )
}
