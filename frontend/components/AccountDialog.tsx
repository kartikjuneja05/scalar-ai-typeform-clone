"use client";
import { useState } from "react";
import { ArrowRight, X } from "lucide-react";
import { api, Profile } from "./model";

export default function AccountDialog({
  mode,
  onClose,
  onComplete,
}: {
  mode: "register" | "login";
  onClose: () => void;
  onComplete: (profile: Profile) => Promise<void>;
}) {
  const [view, setView] = useState(mode),
    [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const profile = await api<Profile>(
        `/auth/${view}`,
        "POST",
        view === "register" ? { name, email, password } : { email, password },
      );
      await onComplete(profile);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        className="modal account-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close icon-button"
          disabled={busy}
          aria-label="Close account dialog"
          onClick={onClose}
        >
          <X size={20} />
        </button>
        <span className="brand">iLoveForms</span>
        <h2 id="account-title">
          {view === "register" ? "Make yourself at home." : "Welcome back."}
        </h2>
        <p>
          {view === "register"
            ? "Create an account to keep your forms and access them on any device. Your guest forms come with you."
            : "Sign in to your workspace. You can also keep building as a guest."}
        </p>
        <form onSubmit={submit}>
          {view === "register" && (
            <label>
              Your name
              <input
                autoFocus
                required
                maxLength={80}
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
              />
            </label>
          )}
          <label>
            Email address
            <input
              autoFocus={view === "login"}
              required
              type="email"
              maxLength={254}
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              required
              type="password"
              minLength={8}
              maxLength={128}
              autoComplete={
                view === "register" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary account-submit" disabled={busy}>
            {busy
              ? "Please wait…"
              : view === "register"
                ? "Create account"
                : "Sign in"}
            <ArrowRight size={16} />
          </button>
        </form>
        <p className="account-switch">
          {view === "register"
            ? "Already have an account?"
            : "New to iLoveForms?"}{" "}
          <button
            disabled={busy}
            onClick={() => {
              setView(view === "register" ? "login" : "register");
              setError("");
              setPassword("");
            }}
          >
            {view === "register" ? "Sign in" : "Create an account"}
          </button>
        </p>
        <button className="guest-link" disabled={busy} onClick={onClose}>
          Continue as guest
        </button>
        <small className="account-note">
          No account is needed to fill a published form.
        </small>
      </div>
    </div>
  );
}
