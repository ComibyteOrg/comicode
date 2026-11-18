import { useApp } from "../state/store";

const STATUS_GLYPH: Record<string, string> = {
  start: "◉",
  done: "✓",
  error: "✕",
};

export function ThinkingPanel() {
  const { stages, plan, tools, statusLine, sending } = useApp();
  if (!sending && stages.length === 0 && !plan && tools.length === 0) return null;

  return (
    <section className="thinking panel" aria-label="Agent pipeline">
      <header className="panel-head">
        <span className="pulse-dot" />
        <span className="panel-title">Reasoning pipeline</span>
        <span className="panel-sub">{statusLine.label ?? statusLine.state}</span>
      </header>

      {stages.length > 0 && (
        <div className="stage-rail">
          {stages.map((stage) => (
            <div className={`stage-chip ${stage.status}`} key={stage.stage}>
              <span className="stage-glyph">{STATUS_GLYPH[stage.status] ?? "·"}</span>
              <div className="stage-copy">
                <span className="stage-label">{stage.label ?? stage.stage}</span>
                <span className="stage-dept">{stage.department ?? stage.stage}</span>
              </div>
              {stage.model && <span className="stage-model">{stage.model}</span>}
              {stage.index && stage.total ? (
                <span className="stage-index">
                  {stage.index}/{stage.total}
                </span>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {plan && (
        <div className="plan-block">
          <div className="plan-title">◇ Plan · {plan.summary ?? "working"}</div>
          <ul className="plan-list">
            {(plan.steps ?? []).map((step, index) => (
              <li className={`plan-step ${step.status}`} key={`${step.title}-${index}`}>
                <span className="plan-check">
                  {step.status === "done" ? "✓" : step.status === "running" ? "◉" : "○"}
                </span>
                <span>{step.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {tools.length > 0 && (
        <div className="tool-log">
          {tools.slice(-5).map((tool) => (
            <div className="tool-row" key={tool.id}>
              <span className={`tool-kind ${tool.phase}`}>{tool.phase === "start" ? "→" : "←"}</span>
              <span className="tool-name">{tool.name}</span>
              <span className="tool-arg">{tool.arguments}</span>
              {tool.content && <span className="tool-result">{tool.content.slice(0, 120)}</span>}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
