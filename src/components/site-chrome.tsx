import { Link } from "@tanstack/react-router";

export function SiteHeader() {
  return (
    <header
      className="bg-background sticky top-0 z-40"
      style={{ borderBottom: "0.5px solid rgba(26,17,8,0.12)" }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-8" style={{ height: 56 }}>
        <Link to="/" className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block"
            style={{ width: 8, height: 8, borderRadius: 9999, background: "#D85A30" }}
          />
          <span style={{ fontSize: 20, fontWeight: 500, color: "#1A1108", letterSpacing: "-0.3px" }}>
            Roovr
          </span>
        </Link>
        <nav className="flex items-center gap-6">
          <Link
            to="/pricing"
            style={{ fontSize: 13, color: "#888780" }}
            className="hover:text-foreground transition-colors"
            activeProps={{ style: { fontSize: 13, color: "#1A1108" } }}
          >
            Pricing
          </Link>
          <Link
            to="/"
            className="inline-flex items-center justify-center transition-opacity hover:opacity-90"
            style={{
              background: "#1A1108",
              color: "#FFFDF9",
              fontSize: 13,
              fontWeight: 500,
              borderRadius: 100,
              padding: "10px 20px",
            }}
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
    <footer style={{ background: "#1A1108", marginTop: 96 }}>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-8 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="inline-block"
            style={{ width: 8, height: 8, borderRadius: 9999, background: "#D85A30" }}
          />
          <span style={{ fontSize: 18, fontWeight: 500, color: "#FFFDF9" }}>Roovr</span>
          <span style={{ fontSize: 13, color: "#888780", marginLeft: 12 }}>© 2025 Roovr</span>
        </div>
        <div className="flex gap-6" style={{ fontSize: 13, color: "#888780" }}>
          <Link to="/pricing" className="hover:text-[#FFFDF9] transition-colors">Pricing</Link>
          <a href="#" className="hover:text-[#FFFDF9] transition-colors">Privacy</a>
          <a href="#" className="hover:text-[#FFFDF9] transition-colors">Terms</a>
        </div>
      </div>
    </footer>
  );
}
