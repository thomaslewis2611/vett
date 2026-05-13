import { Link } from "@tanstack/react-router";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-background/80 backdrop-blur sticky top-0 z-40">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link to="/" className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-lg text-primary-foreground font-bold"
            style={{ background: "var(--gradient-primary)" }}
          >
            P
          </div>
          <span className="text-lg font-semibold tracking-tight">Flagr</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/pricing"
            className="rounded-md px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
            activeProps={{ className: "rounded-md px-3 py-2 text-foreground font-medium" }}
          >
            Pricing
          </Link>
          <Link
            to="/"
            className="ml-2 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
          >
            Try free
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border mt-24">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div
            className="flex h-6 w-6 items-center justify-center rounded text-primary-foreground text-xs font-bold"
            style={{ background: "var(--gradient-primary)" }}
          >
            P
          </div>
          <span>© {new Date().getFullYear()} Flagr. The red flags estate agents won't show you.</span>
        </div>
        <div className="flex gap-5">
          <Link to="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
          <a href="#" className="hover:text-foreground transition-colors">Privacy</a>
          <a href="#" className="hover:text-foreground transition-colors">Terms</a>
        </div>
      </div>
    </footer>
  );
}
