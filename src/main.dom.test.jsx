import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

/* ============================================================
   The error boundary, and the way out of it.

   A saved model that loads and then throws while it is being drawn used to be
   the end of the account: the boundary offered a reload, the reload fetched the
   same model, and it threw again. Settings → Reset is behind an App that never
   draws, so there was nothing else to press. The tests here are about the
   second door — the app on a fresh model — and about the two promises it makes:
   that it works, and that it writes nothing.

   Two pieces of machinery are needed before any of that can be looked at.

   main.jsx is a script as much as a module: the last thing it does at import is
   createRoot(document.getElementById("root")).render(...), and in a test there
   is no #root, so importing it throws before a single export arrives. Rather
   than change how the app boots to suit a test, createRoot is stubbed for that
   one container and left alone for every other — Testing Library mounts into
   its own div and needs the real thing.

   App is wrapped rather than replaced, so what renders below is the whole
   actual app, and the props it was handed on every render are on record. That
   record is the no-save proof: `onPersist` is the only way anything leaves App,
   so an App that is never given one cannot write, whatever else it does.
   ============================================================ */
const h = vi.hoisted(() => ({ appProps: [], appThrows: { on: false } }));

vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRoot: (container, options) =>
      !container || container.id === "root"
        ? { render() {}, unmount() {} }
        : actual.createRoot(container, options),
  };
});

vi.mock("./App.jsx", async (importOriginal) => {
  const actual = await importOriginal();
  const Real = actual.default;
  return {
    ...actual,
    default: (props) => {
      h.appProps.push(props);
      // The one thing a wrapper can do that the real App will not: throw on cue,
      // so that "the fresh model threw as well" is a case with a test on it.
      if (h.appThrows.on) throw new Error("the fresh model threw too");
      return React.createElement(Real, props);
    },
  };
});

/* Nothing in the recovered tree may reach the database. Mocked as a client that
   records instead of one that is absent, so that a write attempted through
   persist.js — the only route to the row — would show up here as a call. */
const supabaseCalls = [];
vi.mock("./supabaseClient.js", () => ({
  supabase: { from: (t) => { supabaseCalls.push(t); throw new Error("the recovered app must not touch the row"); } },
}));

const { ErrorBoundary, rememberLoadedState } = await import("./main.jsx");

const Boom = () => { throw new Error("Cannot read properties of undefined (reading 'txns')"); };
const boundary = () => render(<ErrorBoundary><Boom /></ErrorBoundary>);
const freshModel = () => screen.getByRole("button", { name: /carry on in a fresh, empty-of-your-data model/i });

beforeEach(() => {
  h.appProps.length = 0;
  h.appThrows.on = false;
  supabaseCalls.length = 0;
  rememberLoadedState(null);
});

describe("the screen you get when the app throws while drawing", () => {
  it("says what happened, and says the stored data was not the casualty", () => {
    boundary();
    expect(screen.getByRole("alert").textContent).toBe("Something went wrong on this page");
    expect(screen.getByText(/Cannot read properties of undefined/)).toBeTruthy();
    expect(screen.getByText(/has not been changed or\s+deleted/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload the page" })).toBeTruthy();
  });

  it("offers a second way out, because reloading a model that will not draw only lands here again", () => {
    boundary();
    expect(freshModel()).toBeTruthy();
  });
});

describe("the fresh model the boundary offers", () => {
  it("reaches the actual app, and says on screen that this one is not being saved", () => {
    boundary();
    fireEvent.click(freshModel());

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Overview");
    expect(screen.getByText(/this is a fresh, empty model and nothing in it is being saved/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reload the page" })).toBeNull();
  });

  it("hands App no saved model and no way to save, and keeps it that way while it is used", async () => {
    boundary();
    fireEvent.click(freshModel());
    const nav = screen.getByRole("navigation", { name: "Sections" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    // A real edit, of the kind that would normally be on the wire 1.2s later.
    const inflation = screen.getByRole("spinbutton", { name: "Inflation %/yr" });
    fireEvent.change(inflation, { target: { value: "7" } });
    expect(inflation.value).toBe("7");
    // And the one edit that writes immediately rather than on a debounce.
    fireEvent.click(screen.getByRole("button", { name: "Reset the model" }));
    fireEvent.click(screen.getByRole("button", { name: "Yes, clear everything" }));

    // Longer than SAVE_DEBOUNCE_MS: if anything were queued, this is when it goes.
    await new Promise((r) => setTimeout(r, 1500));

    /* One entry, and only ever one: the wrapper re-renders when the boundary
       does, not when App's own state moves, so this is the record of what the
       boundary handed over — which is the whole question. */
    expect(h.appProps.length).toBe(1);
    expect(h.appProps[0].onPersist).toBeUndefined();
    expect(h.appProps[0].boot).toBeUndefined();
    // And the wire itself, watched across the edits and past the debounce.
    expect(supabaseCalls).toEqual([]);
    expect(nav).toBeTruthy();
  });

  it("comes back to the message rather than a blank page when the fresh model throws too", () => {
    boundary();
    h.appThrows.on = true;

    fireEvent.click(freshModel());

    expect(screen.getByRole("alert").textContent).toBe("Something went wrong on this page");
    expect(screen.getByText(/the fresh model threw too/)).toBeTruthy();
    expect(freshModel()).toBeTruthy();
  });
});

/* jsdom has no URL.createObjectURL and no downloads, so what can be checked
   here is that the right bytes are put into the right Blob under the right
   filename — not that a file lands on disk. That part is a browser's job and
   was watched in one. */
describe("getting the data that will not draw out of the app", () => {
  const clicked = [];
  let handOut = null;
  const grabTheDownload = () => {
    clicked.length = 0;
    const blobs = [];
    handOut = (b) => { blobs.push(b); return "blob:ledgerline"; };
    URL.createObjectURL = (b) => handOut(b);
    URL.revokeObjectURL = () => {};
    // Stops jsdom trying to navigate to a blob: URL, and records the anchor.
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () { clicked.push(this); });
    return blobs;
  };
  afterEach(() => { delete URL.createObjectURL; delete URL.revokeObjectURL; vi.restoreAllMocks(); });

  it("downloads the model exactly as it came off the server", async () => {
    const stored = { txns: [{ id: "a1", amountC: 1234 }], settings: { inflationPct: 5 }, oddKey: true };
    rememberLoadedState(stored);
    const blobs = grabTheDownload();
    boundary();

    fireEvent.click(screen.getByRole("button", { name: /Download the data this page loaded/i }));

    expect(clicked.length).toBe(1);
    expect(clicked[0].download).toBe("ledgerline-saved-data.json");
    expect(blobs.length).toBe(1);
    expect(JSON.parse(await blobs[0].text())).toEqual(stored);
    expect(screen.queryByText(/The download did not start/)).toBeNull();
  });

  it("says there is nothing to hand over when the page never got the data", () => {
    boundary();
    expect(screen.queryByRole("button", { name: /Download the data this page loaded/i })).toBeNull();
    expect(screen.getByText(/There is no download to offer/)).toBeTruthy();
  });

  it("says the download failed rather than looking like it worked", async () => {
    rememberLoadedState({ txns: [] });
    grabTheDownload();
    handOut = () => { throw new Error("blocked by the browser"); };
    boundary();

    fireEvent.click(screen.getByRole("button", { name: /Download the data this page loaded/i }));

    await waitFor(() =>
      expect(screen.getByText(/The download did not start: blocked by the browser/)).toBeTruthy());
    expect(clicked.length).toBe(0);
  });
});
