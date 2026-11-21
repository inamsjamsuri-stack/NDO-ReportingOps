export function Footer() {
  const currentYear = new Date().getFullYear()
  return (
    <footer className="border-t px-6 py-4">
      <p className="text-sm text-muted-foreground">
        ReportOps · IOH MS-NDO Performance Reporting · {currentYear}
      </p>
    </footer>
  )
}
