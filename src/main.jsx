import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { supabase } from "./supabaseClient.js";
import { THEME_CSS } from "./theme.js";

/* ============================================================
   Root shell: authentication + persistence around the app.
   - No Supabase env vars  -> demo mode (in-memory, no login)
   - Signed in             -> state loads from `user_state`,
                              every change autosaves (debounced)
   ============================================================ */

const SAVE_DEBOUNCE_MS = 1200;

function AuthScreen({ onDemo }) {
  const [mode, setMode] = useState("signin"); // signin | signup
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!email || !password) { setMsg({ t: "err", s: "Email and password required." }); return; }
    setBusy(true); setMsg(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg({ t: "ok", s: "Account created. If email confirmation is enabled, check your inbox — then sign in." });
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (e) {
      setMsg({ t: "err", s: e.message || "Something went wrong." });
    } finally { setBusy(false); }
  };

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-brand">LEDGER<span>LINE</span></div>
        <div className="auth-sub">Personal finance planning &amp; tracking</div>
        <label className="auth-l">Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()} autoComplete="email" />
        </label>
        <label className="auth-l">Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoComplete={mode === "signup" ? "new-password" : "current-password"} />
        </label>
        {msg && <div className={`auth-msg ${msg.t}`}>{msg.s}</div>}
        <button className="auth-btn" disabled={busy} onClick={submit}>
          {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
        </button>
        <button className="auth-link" onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setMsg(null); }}>
          {mode === "signin" ? "No account? Create one" : "Have an account? Sign in"}
        </button>
        <div className="auth-div" />
        <button className="auth-link dim" onClick={onDemo}>Try the demo without an account (nothing is saved)</button>
      </div>
      <style>{THEME_CSS + AUTH_CSS}</style>
    </div>
  );
}

function Root() {
  const [session, setSession] = useState(null);
  const [boot, setBoot] = useState(undefined); // undefined = loading, null = fresh user
  const [demo, setDemo] = useState(!supabase); // no env vars -> demo automatically
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const timer = useRef(null);
  const latest = useRef(null);

  // auth session tracking
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // load persisted state on sign-in
  useEffect(() => {
    if (!supabase || !session) return;
    setBoot(undefined);
    supabase.from("user_state").select("state").eq("user_id", session.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (error) { console.error(error); setBoot(null); return; }
        setBoot(data ? data.state : null);
      });
  }, [session]);

  const flush = async () => {
    if (!supabase || !session || latest.current == null) return;
    setSaveState("saving");
    const { error } = await supabase.from("user_state").upsert(
      { user_id: session.user.id, state: latest.current, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    setSaveState(error ? "error" : "saved");
    if (error) console.error("Save failed:", error);
  };

  const onPersist = (state) => {
    latest.current = state;
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  };

  // best-effort flush when the tab closes
  useEffect(() => {
    const h = () => { clearTimeout(timer.current); flush(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  });

  if (demo) return (
    <>
      <div className="shell-bar demo">Demo mode — nothing is saved.{supabase && <button onClick={() => setDemo(false)}>Sign in</button>}</div>
      <App />
      <style>{THEME_CSS + BAR_CSS}</style>
    </>
  );

  if (!session) return <AuthScreen onDemo={() => setDemo(true)} />;
  if (boot === undefined) return <div className="shell-load">Loading your data…<style>{THEME_CSS + BAR_CSS}</style></div>;

  return (
    <>
      <div className="shell-bar">
        <span>{session.user.email}</span>
        <span className={`save ${saveState}`}>
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "All changes saved" : saveState === "error" ? "⚠ Save failed — retrying on next change" : ""}
        </span>
        <button onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
      <App boot={boot} onPersist={onPersist} />
      <style>{THEME_CSS + BAR_CSS}</style>
    </>
  );
}

const AUTH_CSS = `
  .auth-wrap { min-height: 100vh; display: grid; place-items: center; background: var(--bg);
    font-family: "Inter", -apple-system, system-ui, sans-serif; }
  .auth-card { width: min(360px, 92vw); background: var(--surface); border: 1px solid var(--border-2); border-radius: 14px;
    padding: 28px 26px; display: flex; flex-direction: column; gap: 12px; }
  .auth-brand { color: var(--text-strong); font-weight: 800; letter-spacing: 3px; font-size: 18px; }
  .auth-brand span { color: var(--accent-strong); }
  .auth-sub { color: var(--text-muted); font-size: 12.5px; margin-bottom: 6px; }
  .auth-l { color: var(--text-label); font-size: 12px; display: flex; flex-direction: column; gap: 5px; }
  .auth-l input { background: var(--bg); border: 1px solid var(--border-2); border-radius: 8px; color: var(--text-strong);
    padding: 9px 11px; font-size: 14px; outline: none; }
  .auth-l input:focus { border-color: var(--accent-deep); }
  .auth-btn { margin-top: 6px; background: var(--accent-deep); color: var(--on-accent); font-weight: 700; border: none;
    border-radius: 8px; padding: 10px; font-size: 14px; cursor: pointer; }
  .auth-btn:disabled { opacity: .6; }
  .auth-link { background: none; border: none; color: var(--accent); font-size: 12.5px; cursor: pointer; padding: 2px; }
  .auth-link.dim { color: var(--text-muted); }
  .auth-div { border-top: 1px solid var(--border-2); margin: 4px 0; }
  .auth-msg { font-size: 12.5px; border-radius: 8px; padding: 8px 10px; }
  .auth-msg.err { background: var(--neg-bg-2); color: var(--neg); }
  .auth-msg.ok { background: var(--accent-bg-2); color: var(--accent); }
`;

const BAR_CSS = `
  .shell-bar { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 14px;
    justify-content: flex-end; padding: 6px 14px; background: var(--surface-bar); border-bottom: 1px solid var(--border-2);
    color: var(--text-muted); font: 12px "Inter", system-ui, sans-serif; }
  .shell-bar.demo { justify-content: center; color: var(--neg); background: var(--demo-bg); }
  .shell-bar button { background: none; border: 1px solid var(--border-2); color: var(--text-label); border-radius: 6px;
    padding: 3px 10px; font-size: 11.5px; cursor: pointer; }
  .shell-bar .save.saved { color: var(--accent-strong); }
  .shell-bar .save.error { color: var(--neg); }
  .shell-load { min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text-muted);
    font: 14px "Inter", system-ui, sans-serif; }
`;

createRoot(document.getElementById("root")).render(<Root />);
