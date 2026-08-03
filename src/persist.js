/* ============================================================
   Reading and writing the single `user_state` row.

   Lifted out of main.jsx so it can be exercised against a stubbed
   client: CI has no Supabase, and "the save is conditional now" is
   not a claim worth taking on trust after an unconditional one ate
   a morning's work.

   The write is a compare-and-set. Every row carries a `rev`; a save
   updates the row only where `rev` still equals the revision this
   tab loaded or last wrote, and bumps it. Two tabs open on the same
   account can no longer silently flatten each other — the second
   one to write changes nothing and is told so.
   ============================================================ */

const TABLE = "user_state";

/* `rev` arrives by migration (supabase/migrations/0001_add_rev.sql), and an
   operator who has not run it yet must still be able to use the app: a client
   that hard-requires an unrun migration fails every single save, which is far
   worse than the cross-tab race it was meant to fix. So a missing column is
   detected and the old unconditional upsert is used instead — same behaviour
   as before this change, race and all, until the migration is run.

   Postgres reports an unknown column as 42703. PostgREST reports the same
   thing as PGRST204 when writing a column it cannot find in its schema cache.
   The message check is only a backstop for clients that drop the code; it
   needs both halves so that an unrelated failure is never mistaken for this
   and quietly downgraded to a blind overwrite. */
export function isMissingRevColumn(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "42703" || code === "PGRST204") return true;
  const text = `${error.message || ""} ${error.details || ""}`.toLowerCase();
  return /\brev\b/.test(text) && (text.includes("does not exist") || text.includes("schema cache"));
}

/* The primary key rejecting an insert means a row appeared under us. */
const isDuplicateRow = (error) => String((error && error.code) || "") === "23505";

const readRev = (data, fallback) => {
  const row = Array.isArray(data) ? data[0] : data;
  return row && row.rev != null ? Number(row.rev) : fallback;
};

/* The pre-migration write, kept verbatim: whole document, no precondition. */
async function legacyUpsert(client, userId, state, updatedAt) {
  const { error } = await client.from(TABLE).upsert(
    { user_id: userId, state, updated_at: updatedAt },
    { onConflict: "user_id" }
  );
  if (error) return { ok: false, error, revSupported: false };
  return { ok: true, rev: null, revSupported: false };
}

/**
 * Read the stored row and the revision it is at.
 * Resolves { ok: true, state, rev, revSupported } or { ok: false, error }.
 * `state: null` means this user has no row yet; `rev: null` means there is no
 * revision to check a save against, so the next save inserts.
 */
export async function loadUserState(client, userId) {
  let revSupported = true;
  let { data, error } = await client.from(TABLE).select("state, rev").eq("user_id", userId).maybeSingle();
  if (error && isMissingRevColumn(error)) {
    // Pre-migration database. Read what is actually there rather than turning
    // a column we added into "we could not load your data".
    revSupported = false;
    ({ data, error } = await client.from(TABLE).select("state").eq("user_id", userId).maybeSingle());
  }
  if (error) return { ok: false, error };
  return {
    ok: true,
    state: data ? data.state : null,
    rev: data && revSupported ? readRev(data, 0) : null,
    revSupported,
  };
}

/**
 * Save, but only over the revision we think is there.
 * Resolves { ok: true, rev, revSupported }, or { ok: false, conflict: true }
 * when the row has moved on, or { ok: false, error } for everything else.
 * Nothing here decides what to do about a conflict — that is the user's call.
 */
export async function saveUserState(client, { userId, state, rev, revSupported = true }) {
  const updatedAt = new Date().toISOString();

  if (revSupported === false) return legacyUpsert(client, userId, state, updatedAt);

  if (rev == null) {
    // No row for this user yet. Insert rather than upsert: if a row has
    // appeared since this tab loaded, the primary key refuses it, and that is
    // another writer to be reported — not something to overwrite.
    const { data, error } = await client.from(TABLE)
      .insert({ user_id: userId, state, rev: 0, updated_at: updatedAt })
      .select("rev");
    if (error) {
      if (isMissingRevColumn(error)) return legacyUpsert(client, userId, state, updatedAt);
      if (isDuplicateRow(error)) return { ok: false, conflict: true };
      return { ok: false, error };
    }
    return { ok: true, rev: readRev(data, 0), revSupported: true };
  }

  const next = rev + 1;
  const { data, error } = await client.from(TABLE)
    .update({ state, rev: next, updated_at: updatedAt })
    .eq("user_id", userId)
    .eq("rev", rev)
    .select("rev");
  if (error) {
    if (isMissingRevColumn(error)) return legacyUpsert(client, userId, state, updatedAt);
    return { ok: false, error };
  }
  /* No row matched: the stored revision is no longer the one we loaded, so
     somebody else wrote first (or the row was deleted). Nothing has been
     overwritten — that is the entire point — so hand it back rather than
     retrying, which would just overwrite them on the second attempt. */
  if (!data || data.length === 0) return { ok: false, conflict: true };
  return { ok: true, rev: readRev(data, next), revSupported: true };
}

/**
 * Overwrite whatever is stored, on the user's explicit instruction, after a
 * conflict. Reads where the row has got to and writes over that revision, so
 * this is still a compare-and-set: if a third write lands in the fraction of a
 * second in between, it reports the conflict again instead of eating it.
 */
export async function forceSaveUserState(client, { userId, state, revSupported = true }) {
  const updatedAt = new Date().toISOString();
  if (revSupported === false) return legacyUpsert(client, userId, state, updatedAt);

  const { data, error } = await client.from(TABLE).select("rev").eq("user_id", userId).maybeSingle();
  if (error) {
    if (isMissingRevColumn(error)) return legacyUpsert(client, userId, state, updatedAt);
    return { ok: false, error };
  }
  return saveUserState(client, {
    userId,
    state,
    rev: data ? readRev(data, 0) : null,
    revSupported: true,
  });
}
