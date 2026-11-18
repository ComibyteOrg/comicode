import { useState } from "react";
import { useApp } from "../state/store";

export function SettingsScreen() {
  const { demo, setDemo, status } = useApp();
  const [accent, setAccent] = useState("cyan");
  const [compact, setCompact] = useState(false);

  const applyAccent = (value: string) => {
    setAccent(value);
    const colors: Record<string, string> = {
      cyan: "#7ce8c3",
      violet: "#b49cff",
      amber: "#f5c46b",
      rose: "#ff8fa3",
    };
    document.documentElement.style.setProperty("--accent", colors[value] ?? colors.cyan);
  };

  return (
    <div className="view-scroll">
      <header className="view-head">
        <div>
          <div className="eyebrow">// preferences</div>
          <h1>Settings</h1>
          <p className="view-sub">Personalize the cockpit. Engine settings live in the CLI.</p>
        </div>
      </header>

      <section className="panel settings-group">
        <h3>Accent</h3>
        <div className="accent-row">
          {[
            ["cyan", "#7ce8c3"],
            ["violet", "#b49cff"],
            ["amber", "#f5c46b"],
            ["rose", "#ff8fa3"],
          ].map(([name, color]) => (
            <button
              key={name}
              type="button"
              className={`accent-swatch ${accent === name ? "selected" : ""}`}
              style={{ background: color }}
              onClick={() => applyAccent(name)}
              aria-label={`${name} accent`}
            />
          ))}
        </div>
      </section>

      <section className="panel settings-group">
        <h3>Interface</h3>
        <label className="toggle-row">
          <span>Compact transcript</span>
          <input type="checkbox" checked={compact} onChange={(e) => setCompact(e.target.checked)} />
        </label>
        <label className="toggle-row">
          <span>Demo data</span>
          <input type="checkbox" checked={demo} onChange={(e) => setDemo(e.target.checked)} />
        </label>
      </section>

      <section className="panel settings-group">
        <h3>Engine</h3>
        <dl className="kv">
          <div><dt>Version</dt><dd>{status?.version ?? "unknown"}</dd></div>
          <div><dt>Mode</dt><dd>{status?.mode ?? "team"}</dd></div>
          <div><dt>Health</dt><dd>{status?.health?.status ?? "ok"}</dd></div>
        </dl>
      </section>
    </div>
  );
}
