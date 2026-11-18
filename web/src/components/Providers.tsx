import { useApp } from "../state/store";

function quotaPercent(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

export function Providers() {
  const { providers, models } = useApp();

  return (
    <div className="view-scroll">
      <header className="view-head">
        <div>
          <div className="eyebrow">// connections</div>
          <h1>Providers &amp; models</h1>
          <p className="view-sub">
            Multiple APIs per provider are supported. The same model is retried on the next key
            before ComiCode tries other models or providers.
          </p>
        </div>
        <span className="status-pill ok">{providers.filter((p) => p.enabled).length} connected</span>
      </header>

      <div className="card-grid">
        {providers.map((provider) => {
          const pct = quotaPercent(provider.quota?.used ?? 0, provider.quota?.limit ?? 1);
          const providerModels = models.filter((m) => m.providerId === provider.providerId);
          return (
            <section className="panel provider-card" key={provider.id}>
              <div className="provider-head">
                <span className={`provider-orb ${provider.enabled ? "on" : "off"}`} />
                <div>
                  <strong>{provider.name}</strong>
                  <span>{provider.providerId}</span>
                </div>
                <span className={`badge ${provider.enabled ? "ok" : "idle"}`}>
                  {provider.enabled ? "active" : "offline"}
                </span>
              </div>
              <div className="quota-row">
                <span>Quota</span>
                <span>{pct}%</span>
              </div>
              <div className="meter-bar">
                <div className={`meter-fill ${pct > 80 ? "warn" : ""}`} style={{ width: `${pct}%` }} />
              </div>
              <div className="provider-models">
                {providerModels.length === 0 ? (
                  <span className="muted">No models discovered</span>
                ) : (
                  providerModels.map((model) => (
                    <span className="model-chip" key={model.id}>
                      {model.displayName}
                      <em className={model.access}>{model.access}</em>
                    </span>
                  ))
                )}
              </div>
              {provider.defaultModel && (
                <div className="provider-default">default · {provider.defaultModel}</div>
              )}
            </section>
          );
        })}
        {providers.length === 0 && (
          <div className="panel empty-panel">
            No providers yet. Run <code>comicode connect</code> in your terminal.
          </div>
        )}
      </div>
    </div>
  );
}
