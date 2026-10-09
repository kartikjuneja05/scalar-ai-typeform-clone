"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, ArrowDown, Check, Star } from "lucide-react";
import { Form, Question, api, validate } from "./model";
export function Answer({
  q,
  value,
  set,
  disabled = false,
}: {
  q: Question;
  value: unknown;
  set: (v: string | number) => void;
  disabled?: boolean;
}) {
  if (["multiple_choice", "yes_no"].includes(q.type))
    return (
      <div className="choices">
        {(q.type === "yes_no" ? ["Yes", "No"] : q.options).map((option, i) => (
          <button
            disabled={disabled}
            key={option}
            className={"choice " + (value === option ? "chosen" : "")}
            onClick={() => set(option)}
          >
            <kbd>{String.fromCharCode(65 + i)}</kbd>
            {option}
            {value === option && <Check size={18} />}
          </button>
        ))}
      </div>
    );
  if (q.type === "rating")
    return (
      <div className="rating">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            disabled={disabled}
            aria-label={`${n} stars`}
            className={Number(value) >= n ? "chosen" : ""}
            key={n}
            onClick={() => set(n)}
          >
            <Star
              size={36}
              fill={Number(value) >= n ? "currentColor" : "none"}
            />
            <small>{n}</small>
          </button>
        ))}
      </div>
    );
  if (q.type === "dropdown")
    return (
      <select
        aria-label={q.title}
        disabled={disabled}
        value={String(value ?? "")}
        onChange={(e) => set(e.target.value)}
      >
        <option value="">Select an option</option>
        {q.options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    );
  if (q.type === "long_text")
    return (
      <textarea
        aria-label={q.title}
        disabled={disabled}
        rows={3}
        className="answer-line"
        placeholder="Type your answer here…"
        value={String(value ?? "")}
        onChange={(e) => set(e.target.value)}
      />
    );
  return (
    <input
      aria-label={q.title}
      disabled={disabled}
      className="answer-line"
      type={
        q.type === "email" ? "email" : q.type === "number" ? "number" : "text"
      }
      placeholder={
        q.type === "email" ? "name@example.com" : "Type your answer here…"
      }
      value={String(value ?? "")}
      onChange={(e) => set(e.target.value)}
    />
  );
}
export default function Flow({
  form,
  preview = false,
  onClose,
}: {
  form: Form;
  preview?: boolean;
  onClose?: () => void;
}) {
  const [step, setStep] = useState(-1),
    [answers, setAnswers] = useState<Record<string, string | number>>({}),
    [error, setError] = useState(""),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const q = form.questions[step];
  useEffect(() => {
    setError("");
    const timer = setTimeout(
      () =>
        container.current
          ?.querySelector<HTMLInputElement>("input,textarea,select")
          ?.focus(),
      100,
    );
    return () => clearTimeout(timer);
  }, [step]);
  async function advance() {
    if (busy || done) return;
    if (step === -1) {
      setStep(0);
      return;
    }
    const message = validate(q, answers[q.id]);
    if (message) {
      setError(message);
      return;
    }
    if (step < form.questions.length - 1) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    try {
      if (!preview)
        await api(`/public/${form.id}/responses`, "POST", {
          answers,
          version: form.version,
        });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className={"flow theme-" + form.theme}
      ref={container}
      onKeyDown={(e) => {
        if (
          e.key === "Enter" &&
          (e.target as HTMLElement).tagName !== "BUTTON" &&
          ((e.target as HTMLElement).tagName !== "TEXTAREA" || e.ctrlKey)
        ) {
          e.preventDefault();
          advance();
        }
        if (
          e.key === "ArrowUp" &&
          (e.target as HTMLElement).tagName !== "SELECT"
        ) {
          e.preventDefault();
          setStep(Math.max(-1, step - 1));
        }
        if (
          e.key === "ArrowDown" &&
          (e.target as HTMLElement).tagName !== "SELECT"
        ) {
          e.preventDefault();
          advance();
        }
      }}
    >
      <div className="flow-top">
        <span className="brand">iLoveForms</span>
        {preview && (
          <button className="light-button" onClick={onClose}>
            Close preview ×
          </button>
        )}
      </div>
      <main className="flow-content" key={done ? "done" : step}>
        {done ? (
          <>
            <div className="success-mark">
              <Check size={32} />
            </div>
            <h1>You’re all done.</h1>
            <p>{form.thank_you}</p>
            {preview && (
              <small>This is a preview. No response was saved.</small>
            )}
          </>
        ) : step === -1 ? (
          <>
            <div className="eyebrow">
              A MOMENT OF YOUR TIME. A LOT OF POSSIBILITIES.
            </div>
            <h1>{form.title}</h1>
            <p>
              We’d love to get to know you a little better.
              <br />
              Make yourself comfortable. Let’s make this a conversation.
            </p>
            <button
              className="flow-button"
              disabled={!form.questions.length}
              onClick={advance}
            >
              Let’s begin <ArrowRight size={20} />
            </button>
            <small>
              {form.questions.length} questions · About{" "}
              {Math.max(1, Math.ceil(form.questions.length * 0.3))} min
            </small>
          </>
        ) : (
          <>
            <div className="question-number">
              {step + 1} <ArrowRight size={18} />
            </div>
            <h1>
              {q.title}
              {q.required && <sup>*</sup>}
            </h1>
            {q.description && <p>{q.description}</p>}
            <Answer
              q={q}
              value={answers[q.id]}
              set={(value) => {
                setAnswers({ ...answers, [q.id]: value });
                setError("");
              }}
              disabled={busy}
            />
            {error && (
              <div role="alert" className="error">
                {error}
              </div>
            )}
            <div className="flow-actions">
              <button className="flow-button" onClick={advance} disabled={busy}>
                {busy
                  ? "Sending…"
                  : step === form.questions.length - 1
                    ? "Submit"
                    : "OK"}{" "}
                <Check size={18} />
              </button>
              <small>
                press <b>Enter ↵</b>
                {q.type === "long_text" ? " (Ctrl + Enter for long text)" : ""}
              </small>
            </div>
          </>
        )}
      </main>
      {step >= 0 && !done && (
        <footer className="flow-footer">
          <div>
            <small>
              {Math.round((step / form.questions.length) * 100)}% completed
            </small>
            <div className="progress">
              <span
                style={{ width: `${(step / form.questions.length) * 100}%` }}
              />
            </div>
          </div>
          <div className="flow-arrows">
            <button
              aria-label="Previous question"
              disabled={busy}
              onClick={() => setStep(Math.max(-1, step - 1))}
            >
              <ArrowUp size={18} />
            </button>
            <button
              aria-label="Next question"
              disabled={busy}
              onClick={advance}
            >
              <ArrowDown size={18} />
            </button>
          </div>
        </footer>
      )}
    </div>
  );
}
