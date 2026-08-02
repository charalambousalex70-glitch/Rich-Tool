import { describe, it, expect, afterEach } from "vitest";
import React from "react";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import App from "./App.jsx";

/* ============================================================
   The app in a real DOM.

   Everything else about this app is tested as arithmetic: react-dom/server
   hands back a string of HTML, effects never run, and nothing can be clicked.
   This file is the other kind of test — the component is mounted into a
   document, its effects run, and it is asked questions the way a person uses
   it: by role and by the name they would read or hear. There are no test ids
   anywhere in this codebase and there is no need for any; every query below
   leans on the accessible name the markup already carries, so a query that
   stops matching is telling us something about the interface and not about
   the test.

   App is the only component this app exports — the other twenty-four are
   module-local consts — so there is no rendering a page on its own. Every test
   here renders the whole app and walks to where it is going by clicking, which
   is what a person does and costs about 0.3s a time.

   The ResizeObserver stub Recharts needs and the unmount after each test are
   in ./dom-setup.js, registered as setupFiles in vite.config.js, so a second
   DOM suite gets both by existing.
   ============================================================ */

describe("the app on the screen it opens with", () => {
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

/* ============================================================
   The sections drawer, below 720px.

   Only the look of this is a media query. The part worth protecting is
   JavaScript and asks nothing about the width: opening moves focus into the
   drawer, Escape closes it, closing puts focus back on the toggle it came
   from, and the page behind it is inert for as long as it is open. All of that
   runs in this document exactly as it runs on a phone.

   What does not run is the CSS. jsdom parses the app's stylesheet — it is why
   .nav-toggle computes as display:none here, from the desktop rule — but it
   drops every @media block whose media list does not name `screen`, so
   `@media (max-width: 720px)` applies at no width at all, and there is no
   viewport to set to make it. A button computing as display:none has no
   accessible name and no role query can reach it, so the two declarations that
   block makes are restated below to put the document at phone width. Restated
   after the render, because jsdom's cascade is document order and the app
   writes its own <style> into the tree it renders.

   Three things about this behaviour therefore cannot be tested here, and are
   still only checked by opening a browser:
     · that the toggle and the drawer's Close appear at 720px and no wider —
       that is the media query itself, and it is the thing being simulated;
     · that the closed drawer leaves the tab order. It does that with
       visibility: hidden inside the same block, and jsdom computes the nav as
       visible; jsdom also has no tab order to leave, since it does not move
       focus on Tab;
     · that inert actually stops focus reaching the page behind. jsdom sets the
       attribute — asserted below — but implements nothing of it: `main.inert`
       reads undefined. That the attribute is there is all this can say.
   ============================================================ */
describe("the sections drawer, at a width where it is a drawer", () => {
  let viewport = null;
  const renderOnAPhone = () => {
    const view = render(<App />);
    viewport = document.createElement("style");
    viewport.textContent = ".nav-toggle { display: inline-flex; } .nav-close { display: inline-grid; }";
    document.body.appendChild(viewport);
    return view;
  };
  afterEach(() => { if (viewport) { viewport.remove(); viewport = null; } });

  it("takes focus into the drawer when it opens, and marks the page behind it inert", async () => {
    renderOnAPhone();
    const toggle = screen.getByRole("button", { name: "Sections" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("main").hasAttribute("inert")).toBe(false);

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("main").hasAttribute("inert")).toBe(true);
    /* Waited for rather than asserted outright: the move is a frame late on
       purpose, because focus set before inert lands is dropped. */
    const close = screen.getByRole("button", { name: "Close the sections menu" });
    await waitFor(() => expect(document.activeElement).toBe(close));
  });

  it("closes on Escape and hands focus back to the toggle it came from", async () => {
    renderOnAPhone();
    const toggle = screen.getByRole("button", { name: "Sections" });
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close the sections menu" })));

    fireEvent.keyDown(document, { key: "Escape" });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("main").hasAttribute("inert")).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(toggle));
  });

  it("closes from its own Close button too, and hands focus back the same way", async () => {
    renderOnAPhone();
    const toggle = screen.getByRole("button", { name: "Sections" });
    fireEvent.click(toggle);
    const close = screen.getByRole("button", { name: "Close the sections menu" });
    await waitFor(() => expect(document.activeElement).toBe(close));

    fireEvent.click(close);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await waitFor(() => expect(document.activeElement).toBe(toggle));
  });
});

/* ============================================================
   Reset, on Settings: the button that asks twice.

   There is no undo behind this and no modal in front of it. The first click
   arms it, the second clears the model, and a live region that stays mounted
   whether it is armed or not says which of the two it is waiting on. The
   cancel path is the one to watch: it has to put the user back exactly where
   they were and touch nothing, and a refactor that broke it would break it
   quietly.

   What was cleared, or not cleared, is read from the model App hands to
   onPersist — that is the model, the same object that would be written to the
   account.
   ============================================================ */
describe("the reset on Settings, which asks before it does anything", () => {
  const goToSettings = () => {
    const nav = screen.getByRole("navigation", { name: "Sections" });
    fireEvent.click(within(nav).getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Settings");
  };

  it("empties the model when the second click confirms it", () => {
    const saved = [];
    render(<App onPersist={(s) => saved.push(s)} />);
    goToSettings();
    expect(screen.getByRole("status").textContent).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Reset the model" }));

    expect(screen.getByRole("status").textContent).toBe("Reset the model? Waiting for confirmation.");
    const confirm = screen.getByRole("button", { name: "Yes, clear everything" });
    expect(document.activeElement).toBe(confirm);

    fireEvent.click(confirm);

    expect(saved.length).toBe(1);
    const model = saved[saved.length - 1];
    expect(model.txns).toEqual([]);
    expect(model.recurring).toEqual([]);
    expect(model.settings.inflationPct).toBe(0);
    /* One line left in the audit trail, saying it happened. */
    expect(model.audit.length).toBe(1);
    expect(model.audit[0].kind).toBe("reset");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Overview");
  });

  it("leaves the model exactly as it was when the second click says keep", () => {
    const saved = [];
    render(<App onPersist={(s) => saved.push(s)} />);
    goToSettings();
    const inflation = screen.getByRole("spinbutton", { name: "Inflation %/yr" });
    expect(inflation.value).toBe("5");

    fireEvent.click(screen.getByRole("button", { name: "Reset the model" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep my figures" }));

    /* Nothing was written at all — not an emptied model, not anything. */
    expect(saved).toEqual([]);
    expect(inflation.value).toBe("5");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Settings");
    expect(screen.getByRole("status").textContent).toBe("");
    const arm = screen.getByRole("button", { name: "Reset the model" });
    expect(document.activeElement).toBe(arm);
  });
});
