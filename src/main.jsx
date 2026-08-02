import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { supabase } from "./supabaseClient.js";
import { loadUserState, saveUserState, forceSaveUserState } from "./persist.js";
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

/* The boundary is mounted outside Root, and by the time it draws, the tree that
   was holding the loaded model has been thrown away. Park what came off the
   server here as it arrives, so a model that will not open can still be handed
   back to the person it belongs to. */
let loadedState = null;
export const rememberLoadedState = (state) => { loadedState = state; };

/* A render throw used to leave a permanently blank page: nothing caught it and
   there is no reset path in the app. Catch it, say so plainly, and offer the
   reload. Nothing here touches the stored row — the data is not the suspect.

   The reload on its own is not an escape, though. A saved model that loads and
   then kills the renderer throws again on every reload, and Settings → Reset is
   behind an App that never draws: the user is locked out of their own account
   for good. So this also offers the way out LoadErrorScreen already has — the
   app on a fresh model, with no `onPersist`, so the copy on the server cannot
   be written over — and a download of that copy, because a model you cannot
   open is still the only one you have. */
export class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null, fresh: false, exportError: null }; }
  /* `fresh` comes off on every throw. If the fresh model is what threw, drawing
     it again is a loop the fallback cannot get out of, and a fallback that
     throws is exactly the blank page this class exists to prevent. */
  static getDerivedStateFromError(error) { return { error, fresh: false }; }
  componentDidCatch(error, info) { console.error("Ledgerline stopped:", error, info); }

  /* Serialised at the click and not in render, because render is the one place
     this component cannot afford to throw. */
  downloadLoaded() {
    try {
      const blob = new Blob([JSON.stringify(loadedState, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "ledgerline-saved-data.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      this.setState({ exportError: null });
    } catch (e) {
      this.setState({ exportError: (e && e.message) || String(e) });
    }
  }

  render() {
    /* No `boot` and no `onPersist`, both deliberate: the saved model is the
       suspect and it is also the only copy, so the way back to a working app is
       to leave it entirely alone. Same bargain LoadErrorScreen offers. */
    if (this.state.fresh) return (
      <>
        <div className="shell-bar demo">
          Your saved data could not be drawn — this is a fresh, empty model and nothing in it is being saved.
          <button onClick={() => window.location.reload()}>Reload and try your saved data again</button>
        </div>
        <App />
        <style>{THEME_CSS + BAR_CSS}</style>
      </>
    );
    if (!this.state.error) return this.props.children;
    const detail = (this.state.error && this.state.error.message) || String(this.state.error);
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1 className="auth-brand">LEDGER<span>LINE</span></h1>
          <div className="auth-sub" role="alert">Something went wrong on this page</div>
          <p className="auth-note">
            Ledgerline hit an error and stopped drawing the page. Your saved data has not been changed or
            deleted — this went wrong while displaying it, not while storing it. Reloading clears a one-off;
            if the same error comes back every time you reload, it is your saved data being drawn that is at
            fault, and reloading will keep bringing you back here.
          </p>
          <div className="auth-msg err mono-s">{detail}</div>
          <button className="auth-btn" onClick={() => window.location.reload()}>Reload the page</button>
          <div className="auth-div" />
          <button className="auth-link dim" onClick={() => this.setState({ fresh: true })}>
            Or carry on in a fresh, empty-of-your-data model. Nothing you do in it will be saved, so what is
            stored on your account stays exactly as it is — including whatever is causing this.
          </button>
          {loadedState ? (
            <button className="auth-link dim" onClick={() => this.downloadLoaded()}>
              Download the data this page loaded, as a .json file. It is what came off the server, before
              anything tried to draw it. Nothing in Ledgerline reads it back in — it is a copy to keep or to
              send on for help, not a restore.
            </button>
          ) : (
            <p className="auth-note">
              There is no download to offer: the page stopped before your saved data reached it, so the app is
              not holding a copy to give you. What is on the server is untouched.
            </p>
          )}
          {this.state.exportError && (
            <div className="auth-msg err mono-s" role="alert">The download did not start: {this.state.exportError}</div>
          )}
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
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error | conflict
  const timer = useRef(null);
  const latest = useRef(null);
  /* The revision this tab loaded or last wrote. Every save is checked against
     it, so a tab that has been sitting idle since breakfast cannot post its
     stale copy over a morning's work done in another one. */
  const rev = useRef(null);
  const revSupported = useRef(true); // false once we find the migration has not been run
  const conflicted = useRef(false);  // a conflict is on screen and unresolved: stop writing
  const inFlight = useRef(false);
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
    /* A model belongs to the account that loaded it. Signing out has to take it
       with it, or the next person to sign in at this keyboard could be offered
       somebody else's figures by the crash screen's download. */
    if (!supabase || !session) { rememberLoadedState(null); return; }
    // A token refresh hands back a new session object and re-runs this effect.
    // Once the user has chosen the fresh model, leave them in it — reloading
    // underneath them would throw away everything they have typed since.
    if (freshAnyway) return;
    let cancelled = false;
    setBoot(undefined); setLoadError(null);
    loadUserState(supabase, session.user.id)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          // Do NOT fall through to boot=null: that seeds the demo model, and the
          // first edit would autosave it straight over the user's real row.
          console.error(res.error);
          clearTimeout(timer.current);
          latest.current = null; // drop any pending save so nothing can flush
          setLoadError(res.error.message || "The server did not answer.");
          return;
        }
        // Read the revision alongside the state: it is what the next save is
        // checked against, and it is only meaningful as at this read.
        rev.current = res.rev;
        revSupported.current = res.revSupported;
        conflicted.current = false;
        // Kept where the boundary can still reach it if drawing this throws.
        rememberLoadedState(res.state);
        setBoot(res.state);
      });
    return () => { cancelled = true; };
  }, [session, attempt, freshAnyway]);

  const retryLoad = () => { setFreshAnyway(false); setLoadError(null); setBoot(undefined); setAttempt((a) => a + 1); };

  /* Every outcome of a write lands here, including the one where we wrote
     nothing. Nothing in this function decides what a conflict means — it puts
     the choice in front of the user and stops. */
  const settle = useCallback((res) => {
    if (res.revSupported === false && revSupported.current) {
      revSupported.current = false;
      console.warn(
        "user_state.rev is missing, so saves cannot be checked against a revision and two tabs can still " +
        "overwrite each other. Run supabase/migrations/0001_add_rev.sql to fix it."
      );
    }
    /* A write that landed means there is nothing left to choose between, so
       the conflict latch comes off here as well as in the two buttons. It is
       the latch that stops `onPersist` putting anything on the wire, and a tab
       that leaves it on while showing "All changes saved" would be lying in
       exactly the way this whole change exists to prevent. */
    if (res.ok) { rev.current = res.rev; conflicted.current = false; setSaveState("saved"); return; }
    if (res.conflict) { conflicted.current = true; setSaveState("conflict"); return; }
    console.error("Save failed:", res.error);
    setSaveState("error");
  }, []);

  const flush = useCallback(async () => {
    const s = sessionRef.current;
    if (!supabase || !s || latest.current == null) return;
    if (conflicted.current) return; // the user has not chosen yet; nothing goes on the wire
    /* Two writes in flight at once would carry the same `rev`, and the loser
       would be reported as somebody else's edit — a conflict this tab caused
       itself. Wait for the one on the wire instead. */
    if (inFlight.current) {
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
      return;
    }
    inFlight.current = true;
    setSaveState("saving");
    let res;
    try {
      res = await saveUserState(supabase, {
        userId: s.user.id,
        state: latest.current,
        rev: rev.current,
        revSupported: revSupported.current,
      });
    } finally { inFlight.current = false; }
    settle(res);
  }, [settle]);

  /* App reports every change here, and its persist effect lists this callback
     among its dependencies. Rebuilt on each render, that was a loop: a save set
     `saveState`, the re-render produced a fresh `onPersist`, the effect saw a
     changed dependency and saved again. One edit followed by twelve seconds of
     doing nothing sent nine upserts, and the indicator never left "Saving…" —
     "All changes saved" was a state the user could not reach. Holding the
     identity steady is the whole fix; the debounce below is unchanged. */
  const onPersist = useCallback((state) => {
    latest.current = state;
    /* An unresolved conflict stops the saving, not the typing. Keep the newest
       keystrokes to hand — "Keep this version" writes exactly this — but put
       nothing on the wire until the user has said which version wins. */
    if (conflicted.current) return;
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

  /* The user chose the version stored elsewhere. Drop what this tab is holding,
     including the pending save, and load the row again — same path as "Try
     again", so the revision comes back with it. */
  const takeStored = () => {
    clearTimeout(timer.current);
    latest.current = null;
    conflicted.current = false;
    setSaveState("idle");
    setBoot(undefined);
    setAttempt((a) => a + 1);
  };

  /* The user chose what is in front of them, knowing it costs the other
     version. Read where the row has got to and write over that. */
  const keepMine = async () => {
    const s = sessionRef.current;
    if (!supabase || !s || latest.current == null) return;
    conflicted.current = false;
    /* Everything `flush` does to keep one write on the wire at a time has to
       happen here too. Without it, a keystroke during this round trip starts
       the debounce again, and that save goes out alongside the force-save
       still carrying the revision we already know is stale. It comes back a
       conflict and sets the latch; the force-save then lands on top and says
       "All changes saved" — leaving a tab that shows no conflict, claims to be
       saved, and quietly writes nothing for the rest of the session. */
    clearTimeout(timer.current);
    inFlight.current = true;
    setSaveState("saving");
    let res;
    try {
      res = await forceSaveUserState(supabase, {
        userId: s.user.id,
        state: latest.current,
        revSupported: revSupported.current,
      });
    } finally { inFlight.current = false; }
    settle(res);
  };

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
      {/* A conflict is the failure half of the split above: the polite region
          says nothing (it must not still be reading "All changes saved"), and
          the assertive one carries it. The buttons sit outside the alert so
          the announcement is the sentence, not the sentence plus its
          furniture. Guessing which version the user wants is exactly how the
          morning got lost in the first place, so we do not guess. */}
      {saveState === "conflict" && (
        <div className="shell-bar clash">
          <span role="alert">
            Not saved. This model was changed in another tab or on another device after this one loaded it,
            so saving would wipe that newer version. Nothing has been overwritten. Tell us which version to keep.
          </span>
          <button onClick={takeStored}>
            Load the newer version — everything you have changed in this tab is lost
          </button>
          <button onClick={keepMine}>
            Keep this version — everything saved in the other tab is lost
          </button>
        </div>
      )}
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
  .auth-brand { color: var(--text-strong); font-weight: 800; letter-spacing: 3px; font-size: 1.125rem; margin: 0; }
  .auth-brand span { color: var(--accent-strong); }
  .auth-sub { color: var(--text-muted); font-size: 0.78125rem; margin-bottom: 6px; }
  .auth-l { color: var(--text-label); font-size: 0.75rem; display: flex; flex-direction: column; gap: 5px; }
  .auth-l input { background: var(--bg); border: 1px solid var(--border-2); border-radius: 8px; color: var(--text-strong);
    padding: 9px 11px; font-size: 0.875rem; }
  .auth-l input:focus { border-color: var(--accent-deep); }
  .auth-btn { margin-top: 6px; background: var(--accent-deep); color: var(--on-accent); font-weight: 700; border: none;
    border-radius: 8px; padding: 10px; font-size: 0.875rem; cursor: pointer; }
  .auth-btn:disabled { opacity: .6; }
  .auth-link { background: none; border: none; color: var(--accent); font-size: 0.78125rem; cursor: pointer; padding: 2px; }
  .auth-link.dim { color: var(--text-muted); }
  .auth-div { border-top: 1px solid var(--border-2); margin: 4px 0; }
  .auth-msg { font-size: 0.78125rem; border-radius: 8px; padding: 8px 10px; }
  .auth-msg.err { background: var(--neg-bg-2); color: var(--neg); }
  .auth-msg.ok { background: var(--accent-bg-2); color: var(--accent); }
  .auth-msg.mono-s { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-size: 0.71875rem; word-break: break-word; }
  .auth-note { color: var(--text-soft); font-size: 0.78125rem; line-height: 1.5; }
  .auth-link { text-align: left; line-height: 1.45; }
`;

const BAR_CSS = `
  .shell-bar { position: sticky; top: 0; z-index: 50; display: flex; align-items: center; gap: 14px;
    justify-content: flex-end; padding: 6px 14px; background: var(--surface-bar); border-bottom: 1px solid var(--border-2);
    color: var(--text-muted); font: 0.75rem "Inter", system-ui, sans-serif; }
  .shell-bar.demo { justify-content: center; color: var(--neg); background: var(--demo-bg); }
  /* Sits under the bar rather than inside it: the sentence has to be readable
     before either button is worth pressing. */
  .shell-bar.clash { position: static; flex-wrap: wrap; justify-content: center; color: var(--neg);
    background: var(--neg-bg-2); padding: 9px 14px; line-height: 1.45; }
  .shell-bar.clash button { border-color: var(--neg); color: var(--neg); }
  .shell-bar button { background: none; border: 1px solid var(--border-2); color: var(--text-label); border-radius: 6px;
    padding: 3px 10px; font-size: 0.71875rem; cursor: pointer; }
  .shell-bar .save.saved { color: var(--accent-strong); }
  .shell-bar .save.error { color: var(--neg); }
  .shell-load { min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text-muted);
    font: 0.875rem "Inter", system-ui, sans-serif; }
`;

createRoot(document.getElementById("root")).render(
  <ErrorBoundary><Root /></ErrorBoundary>
);
