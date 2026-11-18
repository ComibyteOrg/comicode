import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";

export function Composer({
  onSend,
  streaming,
  disabled,
}: {
  onSend: (text: string) => void;
  streaming: boolean;
  disabled?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 168)}px`;
  }, [value]);

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const onChange = (e: ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value);

  return (
    <div className="composer">
      <div className="composer-inner panel">
        <textarea
          ref={ref}
          className="composer-input"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder={streaming ? "Add more context — it is applied live…" : "Describe a task for the agent…"}
          rows={1}
          aria-label="Task prompt"
        />
        <button
          type="button"
          className="send-btn"
          onClick={submit}
          disabled={!value.trim() || disabled === true}
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M22 2 11 13" />
            <path d="M22 2l-7 20-4-9-9-4 20-7z" />
          </svg>
        </button>
      </div>
      <div className="composer-hint">
        <span>
          <kbd>⏎</kbd> send
        </span>
        <span>
          <kbd>⇧⏎</kbd> newline
        </span>
        <span>
          <kbd>⌘⏎</kbd> send
        </span>
        <span className="composer-hint-right">SSE · streaming responses</span>
      </div>
    </div>
  );
}
