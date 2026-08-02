import { describe, it, expect } from "vitest";
import {
  loadUserState, saveUserState, forceSaveUserState, isMissingRevColumn,
} from "./persist.js";

/* ============================================================
   A stubbed Supabase client.

   There is no Supabase in CI and none on the machine this was written on, so
   the compare-and-set is exercised against a recorder: it answers each query
   from a queue and keeps what was asked, which is the part that matters —
   whether the update really carried `.eq("rev", ...)` cannot be checked by
   looking at the return value.
   ============================================================ */
function stub(queue) {
  const calls = [];
  const client = {
    from(table) {
      const call = { table, filters: {} };
      const b = {
        select(cols) { call.op = call.op || "select"; call.select = cols; return b; },
        insert(v) { call.op = "insert"; call.values = v; return b; },
        update(v) { call.op = "update"; call.values = v; return b; },
        upsert(v, o) { call.op = "upsert"; call.values = v; call.opts = o; return b; },
        eq(col, val) { call.filters[col] = val; return b; },
        maybeSingle() { call.single = true; return b; },
        then(res, rej) {
          calls.push(call);
          if (!queue.length) throw new Error(`stub ran out of answers at call ${calls.length}: ${JSON.stringify(call)}`);
          return Promise.resolve(queue.shift()).then(res, rej);
        },
      };
      return b;
    },
  };
  return { client, calls };
}

const USER = "11111111-2222-3333-4444-555555555555";
const STATE = { accounts: [], txns: [] };

const MISSING_COLUMN = { code: "42703", message: 'column user_state.rev does not exist' };
const MISSING_IN_CACHE = { code: "PGRST204", message: "Could not find the 'rev' column of 'user_state' in the schema cache" };

/* ============================================================
   loadUserState
   ============================================================ */
describe("loadUserState", () => {
  it("reads the revision alongside the state", async () => {
    const { client, calls } = stub([{ data: { state: STATE, rev: 7 }, error: null }]);
    const res = await loadUserState(client, USER);
    expect(res).toEqual({ ok: true, state: STATE, rev: 7, revSupported: true });
    expect(calls[0].select).toBe("state, rev");
    expect(calls[0].filters).toEqual({ user_id: USER });
  });

  it("reports no row and no revision for a brand-new user", async () => {
    const { client } = stub([{ data: null, error: null }]);
    const res = await loadUserState(client, USER);
    expect(res).toEqual({ ok: true, state: null, rev: null, revSupported: true });
  });

  it("falls back to the old select when the column is not there yet", async () => {
    const { client, calls } = stub([
      { data: null, error: MISSING_COLUMN },
      { data: { state: STATE }, error: null },
    ]);
    const res = await loadUserState(client, USER);
    expect(res).toEqual({ ok: true, state: STATE, rev: null, revSupported: false });
    expect(calls.map((c) => c.select)).toEqual(["state, rev", "state"]);
  });

  it("still reports a real read failure, and does not retry it", async () => {
    const err = { code: "PGRST301", message: "JWT expired" };
    const { client, calls } = stub([{ data: null, error: err }]);
    const res = await loadUserState(client, USER);
    expect(res).toEqual({ ok: false, error: err });
    expect(calls).toHaveLength(1);
  });
});

/* ============================================================
   saveUserState — the compare-and-set
   ============================================================ */
describe("saveUserState", () => {
  it("writes only over the revision it read, and increments it", async () => {
    const { client, calls } = stub([{ data: [{ rev: 8 }], error: null }]);
    const res = await saveUserState(client, { userId: USER, state: STATE, rev: 7 });
    expect(res).toEqual({ ok: true, rev: 8, revSupported: true });
    expect(calls[0].op).toBe("update");
    expect(calls[0].filters).toEqual({ user_id: USER, rev: 7 });
    expect(calls[0].values.rev).toBe(8);
    expect(calls[0].values.state).toBe(STATE);
  });

  it("carries the new revision forward, so the next save checks against it", async () => {
    const { client, calls } = stub([
      { data: [{ rev: 1 }], error: null },
      { data: [{ rev: 2 }], error: null },
    ]);
    const first = await saveUserState(client, { userId: USER, state: STATE, rev: 0 });
    const second = await saveUserState(client, { userId: USER, state: STATE, rev: first.rev });
    expect(second).toEqual({ ok: true, rev: 2, revSupported: true });
    expect(calls.map((c) => c.filters.rev)).toEqual([0, 1]);
  });

  it("treats zero rows changed as a conflict rather than retrying", async () => {
    const { client, calls } = stub([{ data: [], error: null }]);
    const res = await saveUserState(client, { userId: USER, state: STATE, rev: 7 });
    expect(res).toEqual({ ok: false, conflict: true });
    // The bug being fixed was a second, unconditional write. There must not be one.
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("inserts for a brand-new user with no row", async () => {
    const { client, calls } = stub([{ data: [{ rev: 0 }], error: null }]);
    const res = await saveUserState(client, { userId: USER, state: STATE, rev: null });
    expect(res).toEqual({ ok: true, rev: 0, revSupported: true });
    expect(calls[0].op).toBe("insert");
    expect(calls[0].values).toMatchObject({ user_id: USER, state: STATE, rev: 0 });
  });

  it("calls it a conflict when a row appears under a first-time insert", async () => {
    const { client } = stub([{ data: null, error: { code: "23505", message: "duplicate key value" } }]);
    const res = await saveUserState(client, { userId: USER, state: STATE, rev: null });
    expect(res).toEqual({ ok: false, conflict: true });
  });

  it("falls back to the unconditional upsert when the column is missing", async () => {
    const { client, calls } = stub([
      { data: null, error: MISSING_COLUMN },
      { error: null },
    ]);
    const res = await saveUserState(client, { userId: USER, state: STATE, rev: 3 });
    expect(res).toEqual({ ok: true, rev: null, revSupported: false });
    expect(calls[1].op).toBe("upsert");
    expect(calls[1].opts).toEqual({ onConflict: "user_id" });
    expect(calls[1].values.rev).toBeUndefined();
  });

  it("falls back on the insert path too, and on PostgREST's schema-cache wording", async () => {
    const { client, calls } = stub([
      { data: null, error: MISSING_IN_CACHE },
      { error: null },
    ]);
    const res = await saveUserState(client, { userId: USER, state: STATE, rev: null });
    expect(res.revSupported).toBe(false);
    expect(calls.map((c) => c.op)).toEqual(["insert", "upsert"]);
  });

  it("goes straight to the old write once the column is known to be missing", async () => {
    const { client, calls } = stub([{ error: null }]);
    const res = await saveUserState(client, { userId: USER, state: STATE, rev: null, revSupported: false });
    expect(res).toEqual({ ok: true, rev: null, revSupported: false });
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe("upsert");
  });

  it("reports an ordinary write failure as an error, not a conflict", async () => {
    const err = { code: "42501", message: "new row violates row-level security policy" };
    const { client } = stub([{ data: null, error: err }]);
    const res = await saveUserState(client, { userId: USER, state: STATE, rev: 2 });
    expect(res).toEqual({ ok: false, error: err });
  });
});

/* ============================================================
   forceSaveUserState — the user chose to overwrite
   ============================================================ */
describe("forceSaveUserState", () => {
  it("reads where the row has got to, then writes over that revision", async () => {
    const { client, calls } = stub([
      { data: { rev: 12 }, error: null },
      { data: [{ rev: 13 }], error: null },
    ]);
    const res = await forceSaveUserState(client, { userId: USER, state: STATE });
    expect(res).toEqual({ ok: true, rev: 13, revSupported: true });
    expect(calls[1].filters).toEqual({ user_id: USER, rev: 12 });
  });

  it("inserts if the other tab deleted the row outright", async () => {
    const { client, calls } = stub([
      { data: null, error: null },
      { data: [{ rev: 0 }], error: null },
    ]);
    const res = await forceSaveUserState(client, { userId: USER, state: STATE });
    expect(res).toEqual({ ok: true, rev: 0, revSupported: true });
    expect(calls[1].op).toBe("insert");
  });

  it("reports the conflict again if a third write lands in between", async () => {
    const { client } = stub([
      { data: { rev: 12 }, error: null },
      { data: [], error: null },
    ]);
    const res = await forceSaveUserState(client, { userId: USER, state: STATE });
    expect(res).toEqual({ ok: false, conflict: true });
  });
});

/* ============================================================
   isMissingRevColumn — the guard on the fallback
   ============================================================ */
describe("isMissingRevColumn", () => {
  it("recognises both codes", () => {
    expect(isMissingRevColumn(MISSING_COLUMN)).toBe(true);
    expect(isMissingRevColumn(MISSING_IN_CACHE)).toBe(true);
  });

  it("recognises the message alone, for clients that drop the code", () => {
    expect(isMissingRevColumn({ message: 'column "rev" does not exist' })).toBe(true);
  });

  it("does not downgrade an unrelated failure to a blind overwrite", () => {
    expect(isMissingRevColumn(null)).toBe(false);
    expect(isMissingRevColumn({ message: "Failed to fetch" })).toBe(false);
    expect(isMissingRevColumn({ code: "42501", message: "permission denied for table user_state" })).toBe(false);
    // Neighbouring column, and a word that merely starts with rev.
    expect(isMissingRevColumn({ message: 'column "revenue" does not exist' })).toBe(false);
    expect(isMissingRevColumn({ message: "rev is fine, the network is not" })).toBe(false);
  });
});
