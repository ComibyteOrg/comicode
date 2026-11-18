import { useEffect, useRef } from "react";
import { useApp } from "../state/store";
import { Composer } from "./Composer";
import { Markdown } from "./Markdown";
import { ThinkingPanel } from "./ThinkingPanel";

export function Workspace() {
  const { chat, send, sending, statusLine, error, clearError, demo } = useApp();
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [chat]);

  return (
    <div className="workspace">
      <header className="view-head">
        <div>
          <div className="eyebrow">// workspace</div>
          <h1>Mission control</h1>
          <p className="view-sub">
            A full engineering organization, routed across every free API you connect.
          </p>
        </div>
        <div className="head-status">
          <span className={`status-pill ${sending ? "busy" : "ok"}`}>
            {sending ? "Working" : "Ready"}
          </span>
          <span className="head-mode">{statusLine.label ?? statusLine.state}</span>
        </div>
      </header>

      <div className="transcript">
        {chat.length === 0 && (
          <div className="empty-state">
            <div className="empty-glyph">◇</div>
            <h2>What should the company build?</h2>
            <p>
              Describe any task. Research, architecture, engineering, security, QA, review,
              docs and marketing take it from there — with automatic quota failover.
            </p>
            <div className="empty-examples">
              <button type="button" onClick={() => send("Build a full landing page with a hero image")}>
                Build a landing page
              </button>
              <button type="button" onClick={() => send("Audit this repository for security issues")}>
                Security audit
              </button>
              <button type="button" onClick={() => send("Explain how the routing engine works")}>
                Explain the code
              </button>
            </div>
          </div>
        )}

        {chat.map((message) => (
          <article className={`msg ${message.role}`} key={message.id}>
            <div className="msg-avatar">{message.role === "user" ? "W" : "C"}</div>
            <div className="msg-body">
              <div className="msg-meta">
                <span>{message.role === "user" ? "You" : "ComiCode Company"}</span>
                {message.streaming && <span className="msg-live">● live</span>}
              </div>
              <div className="msg-content">
                {message.content ? <Markdown text={message.content} /> : message.streaming ? <span className="thinking-bars">▒▒▒</span> : null}
              </div>
            </div>
          </article>
        ))}
        <div ref={endRef} />
      </div>

      <ThinkingPanel />

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button type="button" onClick={clearError}>
            dismiss
          </button>
        </div>
      )}

      <Composer onSend={send} streaming={sending} />
      {demo && <div className="demo-note">Demo mode — start <code>comicode serve</code> to use your real providers.</div>}
    </div>
  );
}
