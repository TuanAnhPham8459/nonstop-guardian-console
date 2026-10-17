import { Link } from "@tanstack/react-router";

export function SimBanner() {
  return (
    <div className="sim-banner sticky top-0 z-50">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5">
        <span className="font-mono text-xs font-semibold tracking-widest">
          ⚠ SIMULATED ENVIRONMENT. No production access.
        </span>
        <nav className="flex gap-1 font-mono text-xs">
          <Link to="/" className="tab" activeOptions={{ exact: true }} activeProps={{ className: "tab tab-active" }}>
            Host Terminal
          </Link>
          <Link to="/architecture" className="tab" activeProps={{ className: "tab tab-active" }}>
            Architecture
          </Link>
        </nav>
      </div>
    </div>
  );
}
