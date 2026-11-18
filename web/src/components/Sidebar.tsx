import type { ReactNode } from "react";
import { useApp } from "../state/store";

export type View = "workspace" | "teams" | "providers" | "tasks" | "plugins" | "settings";

const NAV_ITEMS: Array<{ id: View; label: string }> = [
  { id: "workspace", label: "Workspace" },
  { id: "teams", label: "Teams" },
  { id: "providers", label: "Providers" },
  { id: "tasks", label: "History" },
  { id: "plugins", label: "Plugins" },
  { id: "settings", label: "Settings" },
];

const STATUS_META: Record<string, { label: string; className: string }> = {
  running: { label: "Running", className: "busy" },
  queued: { label: "Queued", className: "warn" },
  done: { label: "Done", className: "ok" },
  error: { label: "Error", className: "err" },
  idle: { label: "Idle", className: "ok" },
};

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="7" fill="rgba(124,232,195,0.14)" stroke="rgba(124,232,195,0.55)" />
      <path
        d="M7 15.5 10.5 12 7 8.5"
        stroke="#7ce8c3"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M12.5 15.5 16 12 12.5 8.5"
        stroke="#b49cff"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavGlyph({ id }: { id: View }) {
  const common = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (id) {
    case "workspace":
      return (
        <svg {...common}>
          <path d="M12 2l8.5 4.5L12 11 3.5 6.5L12 2z" />
          <path d="M3.5 12L12 17l8.5-5" />
          <path d="M3.5 17L12 22l8.5-5" />
        </svg>
      );
    case "teams":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="3" />
          <circle cx="16" cy="9" r="2.6" />
          <circle cx="12" cy="16.5" r="3.4" />
        </svg>
      );
    case "providers":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="8" height="8" rx="2" />
          <rect x="13" y="3" width="8" height="8" rx="2" />
          <rect x="3" y="13" width="8" height="8" rx="2" />
          <rect x="13" y="13" width="8" height="8" rx="2" />
        </svg>
      );
    case "tasks":
      return (
        <svg {...common}>
          <rect x="3" y="4.5" width="18" height="15" rx="4" />
          <path d="M8 12l2.5 2.5L16 9.5" />
        </svg>
      );
    case "plugins":
      return (
        <svg {...common}>
          <path d="M12 2l8.5 4.5L12 11 3.5 6.5L12 2z" />
          <path d="M3.5 12L12 17l8.5-5" />
          <path d="M3.5 17L12 22l8.5-5" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <line x1="21" y1="4" x2="14" y2="4" />
          <line x1="10" y1="4" x2="3" y2="4" />
          <line x1="21" y1="12" x2="12" y2="12" />
          <line x1="8" y1="12" x2="3" y2="12" />
          <line x1="21" y1="20" x2="16" y2="20" />
          <line x1="12" y1="20" x2="12" y2="20" />
          <line x1="8" y1="20" x2="3" y2="20" />
        </svg>
      );
  }
}

export function Sidebar({
  view,
  onNavigate,
}: {
  view: View;
  onNavigate: (v: View) => void;
}) {
  const { providers, tasks, statusLine } = useApp();
  const okCount = providers.filter((p) => p.enabled).length;
  const totalUsed = providers.reduce((acc, p) => acc + (p.quota?.used ?? 0), 0);
  const totalLimit = providers.reduce((acc, p) => acc + (p.quota?.limit ?? 0), 0);
  const pct = totalLimit > 0 ? Math.min(100, (totalUsed / totalLimit) * 100) : 0;
  const statusMeta = STATUS_META[statusLine.state] ?? STATUS_META.idle;

  const nav: ReactNode[] = NAV_ITEMS.map((item) => (
    <button
      key={item.id}
      type="button"
      className={`nav-item${view === item.id ? " active" : ""}`}
      onClick={() => onNavigate(item.id)}
      aria-current={view === item.id ? "page" : undefined}
    >
      <span className="nav-icon">
        <NavGlyph id={item.id} />
      </span>
      <span className="nav-text">{item.label}</span>
      {item.id === "tasks" && tasks.length > 0 && (
        <span className="nav-badge">{tasks.length}</span>
      )}
    </button>
  ));

  return (
    <aside className="sidebar">
      <div className="side-inner">
        <div className="side-brand">
          <BrandMark />
          <div className="brand-text">
            <span className="brand-name">ComiCode</span>
            <span className="brand-sub">Mission Control</span>
          </div>
        </div>

        <div className="nav-label">Navigate</div>
        <nav className="side-nav">{nav}</nav>

        <div className="side-section">
          <div className="side-section-title">Providers</div>
          <div className="side-pills">
            {providers.slice(0, 4).map((p) => (
              <div key={p.id} className="side-pill">
                <span className={`pill-dot ${p.enabled ? "ok" : "idle"}`} />
                <span className="pill-name">{p.name}</span>
              </div>
            ))}
            {providers.length > 4 && (
              <div className="side-pill">
                <span className="pill-dot idle" />
                <span className="pill-name">+{providers.length - 4} more</span>
              </div>
            )}
          </div>
        </div>

        <div className="side-meter">
          <div className="meter-label">
            <span>Token usage</span>
            <span className="meter-text">
              {totalUsed.toFixed(2)} / {totalLimit > 0 ? totalLimit.toFixed(2) : "—"}
            </span>
          </div>
          <div className="meter-bar">
            <div className="meter-fill" style={{ width: `${pct}%` }} />
          </div>
        </div>

        <div className="side-foot">
          <span className={`status-pill sm ${statusMeta.className}`} />
          <span className="side-foot-text">{okCount} active · v{status?.version ?? "dev"}</span>
        </div>
      </div>
    </aside>
  );
}
