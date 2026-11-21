import { Link } from "@tanstack/react-router"

import { cn } from "@/lib/utils"

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
  dark?: boolean
}

/** ReportOps wordmark with the four IOH logo colours as a stripe. */
export function Logo({ className, asLink = true, dark = false }: LogoProps) {
  const content = (
    <span className={cn("inline-flex flex-col gap-1", className)}>
      <span className="flex h-1 w-16 overflow-hidden rounded-sm">
        <span className="flex-1 bg-[#FFCB05]" />
        <span className="flex-1 bg-[#32BCAD]" />
        <span className="flex-1 bg-[#EC008C]" />
        <span className="flex-1 bg-[#ED1C24]" />
      </span>
      <span
        className={cn(
          "text-xl font-semibold tracking-wide",
          dark ? "text-white" : "text-foreground",
        )}
      >
        ReportOps
      </span>
    </span>
  )
  if (!asLink) return content
  return <Link to="/">{content}</Link>
}
