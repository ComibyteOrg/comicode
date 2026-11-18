import { useState } from "react";

const STARTER_PLUGINS = [
  { name: "code-review", version: "1.2.0", description: "Structured review checklist and verdicts." },
  { name: "test-driven-change", version: "1.0.3", description: "Red-green-refactor workflow with regression tests." },
  { name: "design-system", version: "0.9.1", description: "Tokens, motion and responsive states for UI work." },
];

export function Plugins() {
  const [source, setSource] = useState("");
  const [installed, setInstalled] = useState(STARTER_PLUGINS);

  const install = () => {
    const value = source.trim();
    if (!value) return;
    const name = value.split(/[\\/]/).pop()!.replace(/\.git$/, "").replace(/[^a-z0-9-_]/gi, "") || "plugin";
    setInstalled((prev) => [...prev, { name, version: "local", description: value }]);
    setSource("");
  };

  return (
    <div className="view-scroll">
      <header className="view-head">
        <div>
          <div className="eyebrow">// extensions</div>
          <h1>Plugins &amp; skills</h1>
          <p className="view-sub">
            Install skill packs and slash-command plugins from a local folder or git URL. Installed
            skills become available to every department in the company.
          </p>
        </div>
      </header>

      <section className="panel install-panel">
        <input
          className="text-input"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && install()}
          placeholder="Local path or git URL (e.g. ./my-plugin)"
          aria-label="Plugin source"
        />
        <button type="button" className="primary-btn" onClick={install}>
          Install plugin
        </button>
      </section>
      <p className="hint-line">
        For real installation use the CLI: <code>comicode plugin install &lt;source&gt;</code>
      </p>

      <div className="card-grid">
        {installed.map((plugin) => (
          <section className="panel plugin-card" key={plugin.name}>
            <div className="plugin-head">
              <div className="plugin-icon">⌁</div>
              <div>
                <strong>{plugin.name}</strong>
                <span>v{plugin.version}</span>
              </div>
            </div>
            <p>{plugin.description}</p>
          </section>
        ))}
      </div>
    </div>
  );
}
