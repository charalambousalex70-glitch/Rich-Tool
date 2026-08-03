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

/* ============================================================
   Accounts: the four seeded rows are no longer the whole of it.

   Until this landed there was no code path anywhere that added, renamed or
   removed an account, so every user was stuck with the four the demo model
   ships with. What matters is not only that the Accounts page can do it, but
   that the rest of the app follows: a new account has to be somewhere a
   transaction can be sent, and a renamed one has to be renamed on every screen
   that names it, because all of them read the same row.

   The delete is the half worth watching. It is refused for as long as anything
   points at the account, because the two ways of not refusing — reassigning
   the rows, or taking them with it — both move the user's balances without
   being asked. What is asserted here is the refusal, the count in it, and that
   nothing at all was written when it happened.

   The model is read back through onPersist, which is the object that would be
   written to the account.
   ============================================================ */
describe("adding, renaming and removing an account", () => {
  /* Matched on the front of the name, not the whole of it: the Imports item
     carries a badge counting the statements imported so far, and that count is
     part of its accessible name. */
  const goTo = (section) => {
    const nav = screen.getByRole("navigation", { name: "Sections" });
    fireEvent.click(within(nav).getByRole("button", { name: new RegExp(`^${section}`) }));
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(section);
  };
  const cardHeading = (name) => screen.getAllByRole("heading", { level: 2 }).find((h) => h.textContent.includes(name));
  const lastSaved = (saved) => saved[saved.length - 1];
  const accountNamed = (model, name) => model.accounts.find((a) => a.name === name);

  it("adds an account, and every screen that has to name one offers it", () => {
    const saved = [];
    render(<App onPersist={(s) => saved.push(s)} />);
    goTo("Accounts");
    expect(screen.queryByLabelText("Name of the account “New account”")).toBe(null);

    fireEvent.click(screen.getByRole("button", { name: "+ Add account" }));
    fireEvent.change(screen.getByLabelText("Name of the account “New account”"), { target: { value: "Savings" } });

    const model = lastSaved(saved);
    expect(model.accounts.length).toBe(5);
    const added = accountNamed(model, "Savings");
    /* A whole row, not a name: the kind decides how the balance is worked out,
       and the id is what every transaction that lands here will carry. */
    expect(added.type).toBe("bank");
    expect(added.openingC).toBe(0);
    expect(added.id.startsWith("acc_")).toBe(true);
    expect(model.accounts.filter((a) => a.id === added.id).length).toBe(1);

    /* The two places a transaction is given an account, and the filter that
       reads them back. All three build from state.accounts, so what is being
       checked is that the new row is really in it. */
    goTo("Transactions");
    expect(within(screen.getByLabelText("Account for the new transaction")).getByRole("option", { name: "Savings" })).toBeTruthy();
    expect(within(screen.getByLabelText("Filter by account")).getByRole("option", { name: "Savings" })).toBeTruthy();
    goTo("Imports");
    expect(within(screen.getByLabelText("Account the imported transactions land in")).getByRole("option", { name: "Savings" })).toBeTruthy();
  });

  it("renames an account everywhere it is named, and writes one audit line for the rename", () => {
    const saved = [];
    render(<App onPersist={(s) => saved.push(s)} />);
    goTo("Accounts");
    const field = screen.getByLabelText("Name of the account “Main Bank Account”");

    fireEvent.focus(field);
    fireEvent.change(field, { target: { value: "Everyday cheque" } });
    fireEvent.blur(field, { target: { value: "Everyday cheque" } });

    const model = lastSaved(saved);
    expect(accountNamed(model, "Everyday cheque")).toBeTruthy();
    expect(accountNamed(model, "Main Bank Account")).toBe(undefined);
    /* Exactly one line for the whole rename, saying what it was before —
       a line per keystroke would bury the audit trail in fragments. */
    const renames = model.audit.filter((a) => a.detail.startsWith("Renamed account"));
    expect(renames.length).toBe(1);
    expect(renames[0].detail).toBe('Renamed account "Main Bank Account" to "Everyday cheque"');

    /* The transaction table names the account of every row it draws, and the
       card on this page carries the name in its heading. */
    goTo("Transactions");
    expect(within(screen.getByLabelText("Account for the new transaction")).getByRole("option", { name: "Everyday cheque" })).toBeTruthy();
    expect(screen.getAllByText("Everyday cheque").length).toBeGreaterThan(0);
    goTo("Accounts");
    expect(cardHeading("Everyday cheque").textContent).toBe("BankEveryday cheque");
  });

  it("refuses to delete an account that transactions point at, and says how many", () => {
    const saved = [];
    render(<App onPersist={(s) => saved.push(s)} />);
    goTo("Accounts");

    fireEvent.click(screen.getByRole("button", { name: "Delete “Main Bank Account”" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete “Main Bank Account”" }));

    /* Seven of the thirteen seeded transactions are on this account. The
       figure is in the message because a refusal that does not say what is
       holding the account is a dead end. */
    const why = screen.getByText(/cannot be deleted/);
    expect(why.textContent).toContain("“Main Bank Account” cannot be deleted with 7 transactions pointing at it");
    expect(why.textContent).toContain("rename this account or change its kind");
    expect(why.getAttribute("role")).toBe("status");

    /* Nothing was written at all — not a deletion, not an audit line. */
    expect(saved).toEqual([]);
    expect(screen.getByLabelText("Name of the account “Main Bank Account”")).toBeTruthy();
  });

  it("refuses a snapshot-only account in the words of what is holding it", () => {
    render(<App />);
    goTo("Accounts");

    fireEvent.click(screen.getByRole("button", { name: "Delete “Investment Portfolio”" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete “Investment Portfolio”" }));

    expect(screen.getByText(/cannot be deleted/).textContent)
      .toContain("“Investment Portfolio” cannot be deleted with 3 balance snapshots pointing at it");
  });

  it("deletes an account nothing points at", () => {
    const saved = [];
    render(<App onPersist={(s) => saved.push(s)} />);
    goTo("Accounts");
    fireEvent.click(screen.getByRole("button", { name: "+ Add account" }));
    expect(lastSaved(saved).accounts.length).toBe(5);

    fireEvent.click(screen.getByRole("button", { name: "Delete “New account”" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete “New account”" }));

    const model = lastSaved(saved);
    expect(model.accounts.length).toBe(4);
    expect(accountNamed(model, "New account")).toBe(undefined);
    expect(model.audit[0].detail).toBe('Deleted account "New account"');
    expect(screen.queryByLabelText("Name of the account “New account”")).toBe(null);
    /* The other four are untouched, and so is everything that pointed at them. */
    expect(model.txns.length).toBe(13);
  });

  it("changes what kind of account it is, and says what that did to the balance", () => {
    const saved = [];
    render(<App onPersist={(s) => saved.push(s)} />);
    goTo("Accounts");

    /* A figure typed in by hand, so the snapshot and the opening balance are
       no longer the same number and the switch has something to move. */
    fireEvent.change(screen.getByLabelText("Balance of Crypto Wallet on that date"), { target: { value: "12345.67" } });
    fireEvent.click(screen.getByRole("button", { name: "Save this balance for Crypto Wallet" }));
    expect(screen.getByText("R12,345.67")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Kind of account “Crypto Wallet” is"), { target: { value: "bank" } });

    const model = lastSaved(saved);
    expect(accountNamed(model, "Crypto Wallet").type).toBe("bank");
    /* Read as a bank account it is its opening balance again, because the
       snapshots stop being read. The audit line is where that is admitted. */
    expect(model.audit[0].detail)
      .toBe('Account "Crypto Wallet" is now a bank account, was crypto — balance R12,345.67 → R32,000.00');
    expect(screen.getByText("R32,000.00")).toBeTruthy();
    /* And it has moved under the heading for its new kind. */
    expect(cardHeading("Crypto Wallet").textContent).toBe("BankCrypto Wallet");
  });

  it("takes an opening balance and puts it straight into the account's figure", () => {
    const saved = [];
    render(<App onPersist={(s) => saved.push(s)} />);
    goTo("Accounts");
    const opening = screen.getByLabelText("Opening balance of “Main Bank Account”");
    expect(opening.value).toBe("42500.00");

    fireEvent.change(opening, { target: { value: "50000" } });
    fireEvent.blur(opening);

    const model = lastSaved(saved);
    expect(accountNamed(model, "Main Bank Account").openingC).toBe(5000000);
    expect(model.audit[0].detail).toBe('Account "Main Bank Account" opening balance → R50,000.00');
  });

  /* accountBalance stops reading openingC the moment an investment or crypto
     account has a snapshot to read instead, so the field is closed there
     rather than left taking edits that change no figure on the screen. */
  it("closes the opening balance on an account whose figure is a balance you typed in", () => {
    render(<App />);
    goTo("Accounts");
    expect(screen.getByLabelText("Opening balance of “Main Bank Account”").disabled).toBe(false);
    expect(screen.getByLabelText("Opening balance of “Investment Portfolio”").disabled).toBe(true);
    expect(screen.getByLabelText("Opening balance of “Crypto Wallet”").disabled).toBe(true);
  });
});
