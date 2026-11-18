import { useState } from "react";
import { Starfield } from "./components/Starfield";
import { Sidebar, type View } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { Teams } from "./components/Teams";
import { Providers } from "./components/Providers";
import { Plugins } from "./components/Plugins";
import { SettingsScreen } from "./components/SettingsScreen";
import { useApp } from "./state/store";

function Tasks() {
  const { tasks } = useApp();
  return (
    <div className="view-scroll">
      <header className="view-head">
        <div>
          <div className="eyebrow">// history</div>
          <h1>Task history</h1>
          <p className="view-sub">Every run is resumable — history survives quota pauses and restarts.</p>
        </div>
      </header>
      <div className="task-list">
        {tasks.map((task) => (
          <article className="panel task-row" key={task.id}>
            <span className={`status-pill ${task.status === "done" ? "ok" : task.status === "running" ? "busy" : "idle"}`}>
              {task.status}
            </span>
            <div className="task-copy">
              <strong>{task.userRequest}</strong>
              <span>{task.phase ?? "task"} · {new Date(task.createdAt).toLocaleString()}</span>
              {task.summary && <p>{task.summary}</p>}
            </div>
          </article>
        ))}
        {tasks.length === 0 && <div className="panel empty-panel">No tasks yet. Start one from the workspace.</div>}
      </div>
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("workspace");
  const { demo, ready } = useApp();

  return (
    <div className="app-shell">
      <Starfield />
      <div className="app-frame">
        <Sidebar view={view} onNavigate={setView} />
        <main className="main-view">
          <div className="topbar">
            <div className="crumbs">
              <span>ComiCode</span><span className="sep">/</span><span className="crumb-current">{view}</span>
            </div>
            <div className="topbar-right">
              {demo && <span className="demo-badge">DEMO</span>}
              <span className="topbar-dot" />
              <span>{ready ? "connected" : "connecting"}</span>
            </div>
          </div>
          <div className="view-body">
            {view === "workspace" && <Workspace />}
            {view === "teams" && <Teams />}
            {view === "providers" && <Providers />}
            {view === "tasks" && <Tasks />}
            {view === "plugins" && <Plugins />}
            {view === "settings" && <SettingsScreen />}
          </div>
        </main>
      </div>
    </div>
  );
}
