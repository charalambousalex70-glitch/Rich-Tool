import React, { useCallback, useEffect, useRef, useState } from "react";
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
        <h1 className="auth-brand">LEDGER<span>LINE</span></h1>
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
        {/* Sign-in failures were drawn and announced to nobody. An error is an
            alert; the "account created" note is only news, so it stays polite. */}
        {msg && <div className={`auth-msg ${msg.t}`} role={msg.t === "err" ? "alert" : "status"}>{msg.s}</div>}
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

/* A render throw used to leave a permanently blank page: nothing caught it and
   there is no reset path in the app. Catch it, say so plainly, and offer the
   reload. Nothing here touches the stored row — the data is not the suspect. */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("Ledgerline stopped:", error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    const detail = (this.state.error && this.state.error.message) || String(this.state.error);
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="auth-brand">LEDGER<span>LINE</span></h1>
          <div className="auth-sub" role="alert">Something went wrong on this page</div>
          <p className="auth-note">
            Ledgerline hit an error and stopped drawing the page. Your saved data has not been changed or
            deleted — this went wrong while displaying it, not while storing it. Reloading usually clears it.
          </p>
          <div className="auth-msg err mono-s">{detail}</div>
          <button className="auth-btn" onClick={() => window.location.reload()}>Reload the page</button>
        </div>
        <style>{THEME_CSS + AUTH_CSS}</style>
      </div>
    );
  }
}

/* A failed load is not the same thing as a new account, and must never be
   treated as one: seeding the demo model here and then autosaving it would
   overwrite the real row. Ask instead. */
function LoadErrorScreen({ detail, onRetry, onFresh }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-brand">LEDGER<span>LINE</span></h1>
        {/* This screen replaces the whole app to say the data did not load, and
            nothing announced it: a screen-reader user was told nothing at all. */}
        <div className="auth-sub" role="alert">We could not load your saved data</div>
        <p className="auth-note">
          Your data is still on the server. This is a problem reaching it — most often a dropped connection —
          not a problem with the data itself. Nothing has been changed or deleted.
        </p>
        {detail && <div className="auth-msg err mono-s">{detail}</div>}
        <button className="auth-btn" onClick={onRetry}>Try again</button>
        <div className="auth-div" />
        <button className="auth-link dim" onClick={onFresh}>
          Or carry on in a fresh, empty-of-your-data model. Nothing you do in it will be saved, so what is
          stored on the server stays exactly as it is.
        </button>
      </div>
      <style>{THEME_CSS + AUTH_CSS}</style>
    </div>
  );
}

function Root() {
  const [session, setSession] = useState(null);
  const [boot, setBoot] = useState(undefined); // undefined = loading, null = fresh user
  const [loadError, setLoadError] = useState(null); // load failed — distinct from "no row yet"
  const [freshAnyway, setFreshAnyway] = useState(false); // chose to work unsaved after a failed load
  const [attempt, setAttempt] = useState(0); // bumped by "Try again"
  const [demo, setDemo] = useState(!supabase); // no env vars -> demo automatically
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error
  const timer = useRef(null);
  const latest = useRef(null);
  /* The save path must not close over `session`: a token refresh hands back a
     new session object, which would give `flush` — and therefore `onPersist` —
     a new identity, and identity is exactly what App's persist effect watches.
     Read the live session through a ref instead. */
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

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
    // A token refresh hands back a new session object and re-runs this effect.
    // Once the user has chosen the fresh model, leave them in it — reloading
    // underneath them would throw away everything they have typed since.
    if (freshAnyway) return;
    let cancelled = false;
    setBoot(undefined); setLoadError(null);
    supabase.from("user_state").select("state").eq("user_id", session.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          // Do NOT fall through to boot=null: that seeds the demo model, and the
          // first edit would autosave it straight over the user's real row.
          console.error(error);
          clearTimeout(timer.current);
          latest.current = null; // drop any pending save so nothing can flush
          setLoadError(error.message || "The server did not answer.");
          return;
        }
        setBoot(data ? data.state : null);
      });
    return () => { cancelled = true; };
  }, [session, attempt, freshAnyway]);

  const retryLoad = () => { setFreshAnyway(false); setLoadError(null); setBoot(undefined); setAttempt((a) => a + 1); };

  const flush = useCallback(async () => {
    const s = sessionRef.current;
    if (!supabase || !s || latest.current == null) return;
    setSaveState("saving");
    const { error } = await supabase.from("user_state").upsert(
      { user_id: s.user.id, state: latest.current, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
    setSaveState(error ? "error" : "saved");
    if (error) console.error("Save failed:", error);
  }, []);

  /* App reports every change here, and its persist effect lists this callback
     among its dependencies. Rebuilt on each render, that was a loop: a save set
     `saveState`, the re-render produced a fresh `onPersist`, the effect saw a
     changed dependency and saved again. One edit followed by twelve seconds of
     doing nothing sent nine upserts, and the indicator never left "Saving…" —
     "All changes saved" was a state the user could not reach. Holding the
     identity steady is the whole fix; the debounce below is unchanged. */
  const onPersist = useCallback((state) => {
    latest.current = state;
    setSaveState("saving");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // best-effort flush when the tab closes
  useEffect(() => {
    const h = () => { clearTimeout(timer.current); flush(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [flush]);

  if (demo) return (
    <>
      <div className="shell-bar demo">Demo mode — nothing is saved.{supabase && <button onClick={() => setDemo(false)}>Sign in</button>}</div>
      <App />
      <style>{THEME_CSS + BAR_CSS}</style>
    </>
  );

  if (!session) return <AuthScreen onDemo={() => setDemo(true)} />;

  if (loadError && !freshAnyway) return (
    <LoadErrorScreen detail={loadError} onRetry={retryLoad} onFresh={() => setFreshAnyway(true)} />
  );
  // Deliberately no `onPersist`: this model cannot reach the stored row at all.
  if (loadError && freshAnyway) return (
    <>
      <div className="shell-bar demo">
        Could not load your saved data — this is a fresh model and nothing in it is being saved.
        <button onClick={retryLoad}>Try loading again</button>
      </div>
      <App />
      <style>{THEME_CSS + BAR_CSS}</style>
    </>
  );

  if (boot === undefined) return <div className="shell-load">Loading your data…<style>{THEME_CSS + BAR_CSS}</style></div>;

  return (
    <>
      <div className="shell-bar">
        <span>{session.user.email}</span>
        {/* Save state was a silent text swap inside a plain span. Never learning
            your data failed to save is the worst outcome this app has, so the
            failure is an assertive alert while the ordinary progress stays
            polite — two elements, because a live region that changes its own
            politeness mid-flight is not reliably re-read. */}
        <span className={`save ${saveState}`} role="status" aria-live="polite" aria-atomic="true">
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? "All changes saved" : ""}
        </span>
        {saveState === "error" && (
          <span className="save error" role="alert">⚠ Save failed — retrying on next change</span>
        )}
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
  /* Same focus treatment as the app: nothing here said where the keyboard was
     either, because the input's outline was switched off outright. */
  .auth-wrap :focus-visible, .shell-bar :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }
  .auth-card { width: min(360px, 92vw); background: var(--surface); border: 1px solid var(--border-2); border-radius: 14px;
    padding: 28px 26px; display: flex; flex-direction: column; gap: 12px; }
  .auth-brand { color: var(--text-strong); font-weight: 800; letter-spacing: 3px; font-size: 18px; margin: 0; }
  .auth-brand span { color: var(--accent-strong); }
  .auth-sub { color: var(--text-muted); font-size: 12.5px; margin-bottom: 6px; }
  .auth-l { color: var(--text-label); font-size: 12px; display: flex; flex-direction: column; gap: 5px; }
  .auth-l input { background: var(--bg); border: 1px solid var(--border-2); border-radius: 8px; color: var(--text-strong);
    padding: 9px 11px; font-size: 14px; }
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
  .auth-msg.mono-s { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 11.5px; word-break: break-word; }
  .auth-note { color: var(--text-soft); font-size: 12.5px; line-height: 1.5; }
  .auth-link { text-align: left; line-height: 1.45; }
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

createRoot(document.getElementById("root")).render(
  <ErrorBoundary><Root /></ErrorBoundary>
);
