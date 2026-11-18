import { useApp } from "../state/store";

const TEAMS = [
  { name: "Research", dept: "Research & Discovery", icon: "◈", model: "reasoning model", tint: "cyan" },
  { name: "Product", dept: "Product & Strategy", icon: "◇", model: "planning model", tint: "violet" },
  { name: "Architecture", dept: "Engineering / Architecture", icon: "⬡", model: "high-context model", tint: "cyan" },
  { name: "Design", dept: "Design / UX", icon: "✦", model: "vision + image model", tint: "violet" },
  { name: "Engineering", dept: "Engineering / Delivery", icon: "⚙", model: "top coding model", tint: "green" },
  { name: "DevOps", dept: "Platform / Reliability", icon: "⇧", model: "coding model", tint: "green" },
  { name: "Security", dept: "Security & Compliance", icon: "⬢", model: "audit reviewer", tint: "amber" },
  { name: "QA", dept: "Quality Assurance", icon: "◉", model: "test writer", tint: "green" },
  { name: "Review", dept: "Best Practice", icon: "✓", model: "code reviewer", tint: "amber" },
  { name: "Docs", dept: "Documentation", icon: "▤", model: "technical writer", tint: "violet" },
  { name: "Marketing", dept: "Marketing & Growth", icon: "◎", model: "copywriter", tint: "violet" },
];

export function Teams() {
  const { stages, sending } = useApp();
  const active = new Map(stages.map((stage) => [stage.label?.toLowerCase() ?? stage.stage, stage.status]));

  const statusFor = (name: string): string => active.get(name.toLowerCase()) ?? "idle";

  return (
    <div className="view-scroll">
      <header className="view-head">
        <div>
          <div className="eyebrow">// organization</div>
          <h1>The company, in one tool</h1>
          <p className="view-sub">
            Each department is a real agent run with its own mode and the best capable model
            available across your connected APIs. Every member receives the exact handoff note
            from the one before it.
          </p>
        </div>
        <span className={`status-pill ${sending ? "busy" : "ok"}`}>
          {sending ? "Pipeline active" : "Standing by"}
        </span>
      </header>

      <div className="org-stage">
        <div className="org-core panel">
          <div className="org-core-glyph">C</div>
          <div>
            <strong>ComiCode Company</strong>
            <span>One prompt → a full software team</span>
          </div>
        </div>
        <div className="org-lines" aria-hidden="true" />
        <div className="org-grid">
          {TEAMS.map((team) => {
            const status = statusFor(team.name);
            return (
              <div className={`team-card panel tint-${team.tint} ${status}`} key={team.name}>
                <div className="team-icon">{team.icon}</div>
                <div className="team-copy">
                  <strong>{team.name}</strong>
                  <span>{team.dept}</span>
                </div>
                <div className="team-foot">
                  <span className="team-model">{team.model}</span>
                  <span className={`team-dot ${status}`} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
