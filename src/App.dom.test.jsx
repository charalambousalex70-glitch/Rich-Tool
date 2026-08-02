import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, within, cleanup } from "@testing-library/react";
import App from "./App.jsx";

/* ============================================================
   The first paint, in a real DOM.

   Everything else about this app is tested as arithmetic: react-dom/server
   hands back a string of HTML, effects never run, and nothing can be clicked.
   This file exists to show that the other kind of test is now possible — the
   component is mounted into a document, its effects run, and it is asked
   questions the way a person uses it: by role and by the name they would read
   or hear. There are no test ids anywhere in this codebase and there is no
   need for any; every query below leans on the accessible name the markup
   already carries, so a query that stops matching is telling us something
   about the interface and not about the test.

   Deliberately thin. This is the harness, not the suite.
   ============================================================ */
/* jsdom is a document, not a browser: it lays nothing out and it has no
   ResizeObserver. Recharts' ResponsiveContainer asks for one in an effect the
   moment a chart mounts, and the Overview page the app opens on has three, so
   without this the whole tree unmounts itself with "ResizeObserver is not
   defined" before a single query runs. Observing nothing is the honest stub:
   nothing here has a size to report. A second component suite will want the
   same three lines, which is an argument for a shared setup file the day
   there is more than one of these. */
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe("the app on the screen it opens with", () => {
  /* Testing Library only tidies up after itself when the runner's hooks are
     globals. This project imports its hooks by name, so the unmount is ours
     to ask for — without it the second render lands in a document that still
     has the first one in it, and every query finds two of everything. */
  afterEach(cleanup);

  it("titles the page with the section it has opened on", () => {
    render(<App />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Overview");
  });

  it("marks Overview in the sections menu as the page you are on", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Sections" });
    const overview = within(nav).getByRole("button", { name: "Overview" });
    expect(overview.getAttribute("aria-current")).toBe("page");
  });
});
