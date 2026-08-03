import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import App, {
  toC, C, C0, C0Short, parseDateAny,
  isFlow, accountBalance,
  monthlyPayment, amortise,
  matchRecurring, matchAnnual,
  buildForecast, buildLongTerm, parseOFX,
  isReadableAmount, isReadableNumber, ageError, termMonthsError,
  AGE_MIN, AGE_MAX, TERM_MONTHS_MAX,
  initialState, blankState,
  uid, hydrate, SCHEMA_VERSION,
} from "./App.jsx";

/* Frozen "now" used by every test that touches nowYm()/todayISO(). */
const FROZEN_NOW = new Date("2026-03-15T12:00:00Z");
const freezeNow = () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(FROZEN_NOW); });
  afterEach(() => { vi.useRealTimers(); });
};

const MINUS = "−"; // U+2212 MINUS SIGN, not ASCII hyphen

/* ============================================================
   toC — money string to integer cents
   ============================================================ */
describe("toC", () => {
  it("parses the US grouped form 1,234.56", () => {
    expect(toC("1,234.56")).toBe(123456);
  });

  it("parses the European grouped form 1.234,56", () => {
    expect(toC("1.234,56")).toBe(123456);
  });

  it("parses a European form with multiple group separators", () => {
    expect(toC("1.234.567,89")).toBe(123456789);
  });

  it("parses negatives in both grouping conventions", () => {
    expect(toC("-45.99")).toBe(-4599);
    expect(toC("-1.234,56")).toBe(-123456);
    expect(toC("-0.01")).toBe(-1);
  });

  it("strips currency symbols and spaces before parsing", () => {
    expect(toC("R 1 000.00")).toBe(100000);
  });

  it("treats a trailing comma with 1-2 digits as a decimal comma", () => {
    expect(toC("12,3")).toBe(1230);
  });

  it("accepts a plain number as well as a string", () => {
    expect(toC(12.34)).toBe(1234);
    expect(toC("1234.5")).toBe(123450);
    expect(toC("5")).toBe(500);
    expect(toC(".5")).toBe(50);
  });

  it("rounds to the nearest cent", () => {
    expect(toC("1.2345")).toBe(123);
    expect(toC("0.005")).toBe(1);
    // "12.345" is dot-grouped thousands, not a fraction — see the grouping tests below
    expect(toC("12.345")).toBe(1234500);
  });

  /* ---- accounting parentheses ---- */
  it("reads accounting parentheses as a negative", () => {
    expect(toC("(45.00)")).toBe(-4500);
    expect(toC("R(1,234.56)")).toBe(-123456);
    expect(toC("(1.234,56)")).toBe(-123456);
  });

  it("does not double-negate a signed value inside parentheses", () => {
    expect(toC("-(45.00)")).toBe(-4500);
    expect(toC("(-45.00)")).toBe(-4500);
  });

  it("leaves unparenthesised and unmatched forms alone", () => {
    expect(toC("-45.00")).toBe(-4500);
    expect(toC("45.00")).toBe(4500);
    expect(toC("(45.00")).toBe(4500);
    expect(toC("45.00)")).toBe(4500);
    expect(toC("")).toBe(0);
    expect(toC("abc")).toBe(0);
    expect(toC("(abc)")).toBe(0);
  });

  /* ---- dot-grouped thousands ---- */
  it("reads dot-grouped thousands as grouping, not a decimal point", () => {
    expect(toC("1.234")).toBe(123400);
    expect(toC("12.345.678")).toBe(1234567800);
    expect(toC("-1.234")).toBe(-123400);
  });

  it("only groups on a non-zero 1-3 digit lead followed by exact groups of three", () => {
    expect(toC("0.500")).toBe(50);    // leading zero excluded — still a decimal 0.5
    expect(toC("1.23")).toBe(123);    // two decimals
    expect(toC("1.2345")).toBe(123);  // four digits
    expect(toC("1234.5")).toBe(123450);
  });

  it("lets the European comma rule win over dot grouping", () => {
    expect(toC("1.234,56")).toBe(123456);
    expect(toC("1,234.56")).toBe(123456);
    expect(toC("1.234.567,89")).toBe(123456789);
  });

  it("returns 0 for empty and nullish input", () => {
    expect(toC("")).toBe(0);
    expect(toC(null)).toBe(0);
    expect(toC(undefined)).toBe(0);
  });

  it("returns 0 for unparseable garbage", () => {
    expect(toC("abc")).toBe(0);
    expect(toC("0")).toBe(0);
  });

  it("always returns an integer number of cents", () => {
    ["1,234.56", "1.234,56", "12.345", "-45.99", "R 1 000.00"].forEach((v) => {
      expect(Number.isInteger(toC(v))).toBe(true);
    });
  });
});

/* ============================================================
   isReadableAmount — tells "unreadable" apart from "genuinely zero",
   which toC alone cannot do (it returns 0 for both).
   ============================================================ */
describe("isReadableAmount", () => {
  it("rejects the input that would otherwise book a silent R0.00", () => {
    expect(isReadableAmount("abc")).toBe(false);
    expect(isReadableAmount("n/a")).toBe(false);
    expect(isReadableAmount("-")).toBe(false);
    expect(isReadableAmount(".")).toBe(false);
    expect(isReadableAmount("R")).toBe(false);
  });

  it("rejects empty and missing values", () => {
    expect(isReadableAmount("")).toBe(false);
    expect(isReadableAmount("   ")).toBe(false);
    expect(isReadableAmount(null)).toBe(false);
    expect(isReadableAmount(undefined)).toBe(false);
  });

  it("accepts a deliberate zero — that is a real figure, not a fallback", () => {
    expect(isReadableAmount("0")).toBe(true);
    expect(isReadableAmount("0.00")).toBe(true);
    expect(isReadableAmount(0)).toBe(true);
  });

  it("accepts every form toC is built to read", () => {
    ["1,234.56", "1.234,56", "-45.99", "R 1 000.00", "(45.00)", "12,3", ".5", "5"]
      .forEach((v) => expect(isReadableAmount(v)).toBe(true));
  });

  it("agrees with toC: anything it accepts, toC reads as a figure", () => {
    ["1,234.56", "1.234,56", "-45.99", "R 1 000.00", "(45.00)", "12,3"]
      .forEach((v) => { expect(isReadableAmount(v)).toBe(true); expect(toC(v)).not.toBe(0); });
  });
});

describe("isReadableNumber", () => {
  it("rejects a cleared field, which used to become 0", () => {
    expect(isReadableNumber("")).toBe(false);
    expect(isReadableNumber("   ")).toBe(false);
    expect(isReadableNumber(null)).toBe(false);
    expect(isReadableNumber(undefined)).toBe(false);
  });

  it("rejects text", () => {
    expect(isReadableNumber("abc")).toBe(false);
    expect(isReadableNumber("5%")).toBe(false);
    expect(isReadableNumber("1,5")).toBe(false);
  });

  it("accepts plain numbers, including zero and negatives", () => {
    expect(isReadableNumber("0")).toBe(true);
    expect(isReadableNumber("5.5")).toBe(true);
    expect(isReadableNumber("-2")).toBe(true);
    expect(isReadableNumber(9)).toBe(true);
  });
});

/* ============================================================
   ageError / termMonthsError — bounds on the inputs that drive
   the long-term projection.
   ============================================================ */
describe("ageError", () => {
  const st = { currentAge: 42, retirementAge: 65, planningAge: 90 };

  it("accepts the seeded assumptions unchanged", () => {
    expect(ageError("currentAge", 42, st)).toBeNull();
    expect(ageError("retirementAge", 65, st)).toBeNull();
    expect(ageError("planningAge", 90, st)).toBeNull();
  });

  it("rejects anything outside the absolute age range", () => {
    ["currentAge", "retirementAge", "planningAge"].forEach((f) => {
      expect(ageError(f, AGE_MIN - 1, st)).toMatch(/between 18 and 120/);
      expect(ageError(f, AGE_MAX + 1, st)).toMatch(/between 18 and 120/);
      // the bounds themselves are in range (they may still fail a cross-field rule)
      expect(String(ageError(f, AGE_MIN, st))).not.toMatch(/between 18 and 120/);
      expect(String(ageError(f, AGE_MAX, st))).not.toMatch(/between 18 and 120/);
    });
  });

  it("rejects a non-number", () => {
    expect(ageError("currentAge", NaN, st)).toMatch(/whole number/);
    expect(ageError("planningAge", Infinity, st)).toMatch(/whole number/);
  });

  it("requires the planning age to sit above the current age", () => {
    expect(ageError("planningAge", 42, st)).toMatch(/above your current age/);
    expect(ageError("planningAge", 41, st)).toMatch(/above your current age/);
    expect(ageError("planningAge", 43, st)).toBeNull();
  });

  it("requires the current age to sit below the planning age", () => {
    expect(ageError("currentAge", 90, st)).toMatch(/below your planning age/);
    expect(ageError("currentAge", 91, st)).toMatch(/below your planning age/);
    expect(ageError("currentAge", 89, st)).toBeNull();
  });

  it("allows a retirement age below the current age — already retired", () => {
    const retired = { currentAge: 70, retirementAge: 65, planningAge: 95 };
    expect(ageError("retirementAge", 65, retired)).toBeNull();
    expect(ageError("retirementAge", 18, retired)).toBeNull();
    expect(ageError("currentAge", 70, retired)).toBeNull();
  });

  it("keeps buildLongTerm non-empty for every combination it accepts", () => {
    const combos = [[42, 65, 90], [70, 65, 95], [18, 18, 19], [60, 60, 120]];
    combos.forEach(([currentAge, retirementAge, planningAge]) => {
      const settings = { currentAge, retirementAge, planningAge };
      expect(ageError("currentAge", currentAge, settings)).toBeNull();
      expect(ageError("retirementAge", retirementAge, settings)).toBeNull();
      expect(ageError("planningAge", planningAge, settings)).toBeNull();
      expect(planningAge - currentAge).toBeGreaterThan(0);
    });
  });

  it("rounds before checking, matching what the field commits", () => {
    expect(ageError("planningAge", 42.4, st)).toMatch(/above your current age/);
    expect(ageError("planningAge", 42.6, st)).toBeNull();
  });
});

describe("termMonthsError", () => {
  it("accepts a realistic remaining term", () => {
    expect(termMonthsError(216)).toBeNull();
    expect(termMonthsError(1)).toBeNull();
    expect(termMonthsError(TERM_MONTHS_MAX)).toBeNull();
  });

  it("rejects zero, negatives and absurd terms", () => {
    expect(termMonthsError(0)).toMatch(/between 1 and 600/);
    expect(termMonthsError(-12)).toMatch(/between 1 and 600/);
    expect(termMonthsError(TERM_MONTHS_MAX + 1)).toMatch(/between 1 and 600/);
  });

  it("rejects a non-number", () => {
    expect(termMonthsError(NaN)).toMatch(/whole number/);
  });
});

/* ============================================================
   C / C0 — cents to display string
   ============================================================ */
describe("C", () => {
  it("formats positive cents with grouping and two decimals", () => {
    expect(C(0)).toBe("R0.00");
    expect(C(1)).toBe("R0.01");
    expect(C(100)).toBe("R1.00");
    expect(C(123456)).toBe("R1,234.56");
    expect(C(1234567890)).toBe("R12,345,678.90");
  });

  it("uses a U+2212 MINUS SIGN for negatives, not an ASCII hyphen", () => {
    const s = C(-123456);
    expect(s).toBe(`${MINUS}R1,234.56`);
    expect(s.charCodeAt(0)).toBe(0x2212);
    expect(s.startsWith("-")).toBe(false);
  });

  it("honours a currency override", () => {
    expect(C(123456, "$")).toBe("$1,234.56");
  });

  it("pads the cents component to two digits", () => {
    expect(C(5)).toBe("R0.05");
    expect(C(-5)).toBe(`${MINUS}R0.05`);
  });
});

describe("C0", () => {
  it("rounds to whole units and drops the decimals", () => {
    expect(C0(0)).toBe("R0");
    expect(C0(100)).toBe("R1");
    expect(C0(123456)).toBe("R1,235");
  });

  it("uses a U+2212 MINUS SIGN for negatives", () => {
    const s = C0(-123456);
    expect(s).toBe(`${MINUS}R1,235`);
    expect(s.charCodeAt(0)).toBe(0x2212);
    expect(s.startsWith("-")).toBe(false);
  });

  it("honours a currency override", () => {
    expect(C0(123456, "$")).toBe("$1,235");
  });
});

/* ============================================================
   C0Short — chart axis labels on a phone-width card, nowhere else
   ============================================================ */
describe("C0Short", () => {
  it("leaves anything under a thousand units alone", () => {
    expect(C0Short(0)).toBe("R0");
    expect(C0Short(99900)).toBe("R999");
  });

  it("abbreviates thousands, millions and billions", () => {
    expect(C0Short(120000)).toBe("R1.2k");
    expect(C0Short(1250000)).toBe("R13k");
    expect(C0Short(123456789)).toBe("R1.2m");
    expect(C0Short(250000000000)).toBe("R2.5b");
  });

  it("keeps one decimal below ten, so 1.4m does not read as 1m", () => {
    expect(C0Short(140000000)).toBe("R1.4m");
    expect(C0Short(1400000000)).toBe("R14m");
  });

  it("uses a U+2212 MINUS SIGN, like every other money formatter here", () => {
    const s = C0Short(-123456789);
    expect(s).toBe(`${MINUS}R1.2m`);
    expect(s.startsWith("-")).toBe(false);
  });

  it("honours a currency override", () => {
    expect(C0Short(123456789, "$")).toBe("$1.2m");
  });
});

/* ============================================================
   parseDateAny
   ============================================================ */
describe("parseDateAny", () => {
  it("passes ISO dates through, padding month and day", () => {
    expect(parseDateAny("2026-07-15")).toBe("2026-07-15");
    expect(parseDateAny("2026-7-5")).toBe("2026-07-05");
    expect(parseDateAny("2026/7/5")).toBe("2026-07-05");
  });

  it("reads an ambiguous d/m/y as day-first by default", () => {
    expect(parseDateAny("3/4/2026")).toBe("2026-04-03");
  });

  it("reads an ambiguous date as month-first when dayFirst is false", () => {
    expect(parseDateAny("3/4/2026", false)).toBe("2026-03-04");
  });

  it("swaps day and month when the heuristic sees an impossible month", () => {
    // dayFirst=true would give month 15; the heuristic swaps because day <= 12
    expect(parseDateAny("07/15/2026", true)).toBe("2026-07-15");
    // dayFirst=false would give month 15; same swap in the other direction
    expect(parseDateAny("15/07/2026", false)).toBe("2026-07-15");
  });

  it("does not swap when the day-first reading is already valid", () => {
    expect(parseDateAny("15/07/2026", true)).toBe("2026-07-15");
  });

  it("expands a two-digit year into the 2000s", () => {
    expect(parseDateAny("1/2/26")).toBe("2026-02-01");
  });

  it("accepts dot and dash separators", () => {
    expect(parseDateAny("12.03.2026")).toBe("2026-03-12");
    expect(parseDateAny("31-12-2025")).toBe("2025-12-31");
  });

  it("converts an Excel serial number", () => {
    expect(parseDateAny(45000)).toBe("2023-03-15");
    expect(parseDateAny(0)).toBe("1899-12-30"); // Excel epoch offset 25569
  });

  it("reads a bare OFX YYYYMMDD", () => {
    expect(parseDateAny("20260715")).toBe("2026-07-15");
  });

  it("returns null for nullish and unparseable input", () => {
    expect(parseDateAny(null)).toBeNull();
    expect(parseDateAny(undefined)).toBeNull();
    expect(parseDateAny("garbage")).toBeNull();
  });
});

/* ============================================================
   isFlow
   ============================================================ */
describe("isFlow", () => {
  const cats = [
    { id: "c_food", kind: "expense" },
    { id: "c_sal", kind: "income" },
    { id: "c_tr", kind: "transfer" },
  ];

  it("counts a normal categorised expense as a flow", () => {
    expect(isFlow({ categoryId: "c_food", amountC: -100 }, cats)).toBe(true);
    expect(isFlow({ categoryId: "c_sal", amountC: 100 }, cats)).toBe(true);
  });

  it("excludes transactions flagged excluded", () => {
    expect(isFlow({ categoryId: "c_food", excluded: true }, cats)).toBe(false);
  });

  it("excludes transactions flagged as a transfer", () => {
    expect(isFlow({ categoryId: "c_food", transfer: true }, cats)).toBe(false);
  });

  it("excludes transactions whose category kind is transfer", () => {
    expect(isFlow({ categoryId: "c_tr" }, cats)).toBe(false);
  });

  it("treats an unknown or missing category as a flow", () => {
    expect(isFlow({ categoryId: "not_a_category" }, cats)).toBe(true);
    expect(isFlow({}, cats)).toBe(true);
  });
});

/* ============================================================
   accountBalance
   ============================================================ */
describe("accountBalance", () => {
  const txns = [
    { accountId: "a1", date: "2026-01-05", amountC: -10000 },
    { accountId: "a1", date: "2026-02-05", amountC: -20000 },
    { accountId: "a1", date: "2026-03-05", amountC: 50000, excluded: true },
    { accountId: "a1", date: "2026-03-06", amountC: 7000, transfer: true },
    { accountId: "a2", date: "2026-01-05", amountC: -99999 },
  ];
  // deliberately out of chronological order
  const snaps = [
    { accountId: "inv", date: "2026-01-31", balanceC: 100000 },
    { accountId: "inv", date: "2026-03-31", balanceC: 300000 },
    { accountId: "inv", date: "2026-02-28", balanceC: 200000 },
  ];

  it("sums opening balance plus this account's transactions", () => {
    const bank = { id: "a1", type: "bank", openingC: 100000 };
    // 100000 - 10000 - 20000 + 7000 (transfer counts) ; the excluded 50000 does not
    expect(accountBalance(bank, txns, snaps)).toBe(77000);
  });

  it("ignores excluded transactions but still counts transfers", () => {
    const bank = { id: "a1", type: "bank", openingC: 0 };
    const withTransfer = accountBalance(bank, txns, snaps);
    const withoutTransfer = accountBalance(
      bank,
      txns.filter((t) => !t.transfer),
      snaps,
    );
    expect(withTransfer - withoutTransfer).toBe(7000);
  });

  it("honours the uptoDate cutoff", () => {
    const bank = { id: "a1", type: "bank", openingC: 100000 };
    expect(accountBalance(bank, txns, snaps, "2026-02-01")).toBe(90000);
  });

  it("takes the latest snapshot for investment accounts", () => {
    const inv = { id: "inv", type: "investment", openingC: 5 };
    expect(accountBalance(inv, txns, snaps)).toBe(300000);
  });

  it("takes the latest snapshot at or before uptoDate", () => {
    const inv = { id: "inv", type: "investment", openingC: 5 };
    expect(accountBalance(inv, txns, snaps, "2026-02-28")).toBe(200000);
    expect(accountBalance(inv, txns, snaps, "2026-03-01")).toBe(200000);
  });

  it("falls back to the opening balance when no snapshot qualifies", () => {
    const inv = { id: "inv", type: "investment", openingC: 5 };
    expect(accountBalance(inv, txns, snaps, "2026-01-01")).toBe(5);
    const crypto = { id: "nosnaps", type: "crypto", openingC: 4242 };
    expect(accountBalance(crypto, txns, snaps)).toBe(4242);
  });

  /* ---- contributions on top of the mark to market ---- */

  /* A transfer to the portfolio has two legs. The bank leg is read, so the
     money leaves; the portfolio leg was not, so it arrived nowhere and every
     month the user saved took their net worth down by what they saved. */
  it("counts money paid into an investment account after its last snapshot", () => {
    const bank = { id: "b", type: "bank", openingC: 1000000 };
    const inv = { id: "i", type: "investment", openingC: 0 };
    const s = [{ accountId: "i", date: "2026-02-28", balanceC: 5000000 }];
    const t = [
      { accountId: "b", date: "2026-03-06", amountC: -500000, transfer: true },
      { accountId: "i", date: "2026-03-06", amountC: 500000, transfer: true },
    ];
    expect(accountBalance(bank, t, s)).toBe(500000);
    expect(accountBalance(inv, t, s)).toBe(5500000);
    // a transfer moves money between two accounts; it does not destroy any
    expect(accountBalance(bank, t, s) + accountBalance(inv, t, s)).toBe(6000000);
  });

  /* The snapshot is the market value on its date, so it already contains
     everything paid in before it — counting those again would credit the
     contribution twice. */
  it("adds the transactions after the snapshot and not the ones before it", () => {
    const inv = { id: "i", type: "investment", openingC: 111 };
    const s = [{ accountId: "i", date: "2026-02-28", balanceC: 5000000 }];
    const t = [
      { accountId: "i", date: "2026-01-10", amountC: 900000 },
      { accountId: "i", date: "2026-02-01", amountC: 400000 },
      { accountId: "i", date: "2026-03-10", amountC: 100000 },
      { accountId: "i", date: "2026-03-11", amountC: -30000 },
    ];
    expect(accountBalance(inv, t, s)).toBe(5070000);
  });

  it("treats a contribution dated on the snapshot day as already inside it", () => {
    const inv = { id: "i", type: "investment", openingC: 0 };
    const s = [{ accountId: "i", date: "2026-02-28", balanceC: 5000000 }];
    const t = [{ accountId: "i", date: "2026-02-28", amountC: 700000 }];
    expect(accountBalance(inv, t, s)).toBe(5000000);
  });

  /* No snapshot means nothing has been marked to market, so there is nothing
     for the transactions to sit on top of and the account is read like a bank
     account. */
  it("opens plus every transaction when the account has no snapshot at all", () => {
    const inv = { id: "i", type: "investment", openingC: 300000 };
    const t = [
      { accountId: "i", date: "2026-01-10", amountC: 100000 },
      { accountId: "i", date: "2026-03-10", amountC: 250000 },
    ];
    expect(accountBalance(inv, t, [])).toBe(650000);
  });

  it("ignores an excluded transaction dated after the snapshot", () => {
    const inv = { id: "i", type: "investment", openingC: 0 };
    const s = [{ accountId: "i", date: "2026-02-28", balanceC: 5000000 }];
    const t = [
      { accountId: "i", date: "2026-03-10", amountC: 100000, excluded: true },
      { accountId: "i", date: "2026-03-11", amountC: 40000 },
    ];
    expect(accountBalance(inv, t, s)).toBe(5040000);
  });

  it("reads only this account's transactions", () => {
    const inv = { id: "i", type: "investment", openingC: 0 };
    const s = [{ accountId: "i", date: "2026-02-28", balanceC: 5000000 }];
    const t = [{ accountId: "other", date: "2026-03-10", amountC: 100000 }];
    expect(accountBalance(inv, t, s)).toBe(5000000);
  });

  /* Asked for an earlier date, the whole rule moves back with it: the snapshot
     that was latest then, and only the contributions between that snapshot and
     the cutoff. This is what draws the nine-month chart on the Accounts page. */
  it("applies the rule as at uptoDate, from the snapshot that was latest then", () => {
    const inv = { id: "i", type: "investment", openingC: 111 };
    const s = [
      { accountId: "i", date: "2026-01-31", balanceC: 1000000 },
      { accountId: "i", date: "2026-02-28", balanceC: 5000000 },
    ];
    const t = [
      { accountId: "i", date: "2026-02-10", amountC: 200000 },
      { accountId: "i", date: "2026-03-10", amountC: 700000 },
    ];
    expect(accountBalance(inv, t, s, "2026-02-15")).toBe(1200000); // Jan snapshot + the Feb 10 payment
    expect(accountBalance(inv, t, s, "2026-02-28")).toBe(5000000); // Feb snapshot, which already holds it
    expect(accountBalance(inv, t, s, "2026-03-31")).toBe(5700000);
  });

  /* The Accounts page snapshot control: contribute, then type in what the
     broker actually says. The new figure supersedes the contributions rather
     than being added to them. */
  it("does not double count contributions when a fresh snapshot is entered over them", () => {
    const inv = { id: "i", type: "investment", openingC: 0 };
    const before = [{ accountId: "i", date: "2026-02-28", balanceC: 5000000 }];
    const t = [{ accountId: "i", date: "2026-03-06", amountC: 500000 }];
    expect(accountBalance(inv, t, before)).toBe(5500000);
    const after = [...before, { accountId: "i", date: "2026-03-31", balanceC: 5620000 }];
    expect(accountBalance(inv, t, after)).toBe(5620000); // the market's figure, not 6120000
  });

  it("uses the same rule for crypto wallets", () => {
    const w = { id: "w", type: "crypto", openingC: 0 };
    const s = [{ accountId: "w", date: "2026-02-28", balanceC: 800000 }];
    const t = [{ accountId: "w", date: "2026-03-06", amountC: 120000 }];
    expect(accountBalance(w, t, s)).toBe(920000);
  });
});

/* accountBalance is both the Overview's net-worth stat and the first row of
   the Long-Term Plan, which 212cb09 made the balances held today. The two are
   computed by different code and are only equal for as long as they read the
   accounts the same way, so pin the agreement rather than either figure. */
describe("the Overview net worth and the long-term plan's first row", () => {
  const overviewNetWorth = (s) => {
    let assets = 0, liab = 0;
    s.accounts.forEach((a) => { const b = accountBalance(a, s.txns, s.snapshots); if (b >= 0) assets += b; else liab += b; });
    assets += s.mortgage.propertyValueC || 0;
    liab += -s.mortgage.balanceC;
    return assets + liab;
  };

  it("agree on the seeded model", () => {
    expect(buildLongTerm(initialState, null).rows[0].netWorthC).toBe(overviewNetWorth(initialState));
  });

  it("agree on the reset model, at zero", () => {
    expect(buildLongTerm(blankState, null).rows[0].netWorthC).toBe(overviewNetWorth(blankState));
    expect(overviewNetWorth(blankState)).toBe(0);
  });

  it("still agree once a contribution lands in the portfolio after its last snapshot", () => {
    const s = structuredClone(initialState);
    const inv = s.accounts.find((a) => a.type === "investment");
    const last = s.snapshots.filter((x) => x.accountId === inv.id).sort((a, b) => a.date.localeCompare(b.date)).pop();
    const after = `${last.date.slice(0, 8)}28`;
    s.txns = [...s.txns, { id: "t_contrib", accountId: inv.id, date: after, amountC: 500000, transfer: true }];
    expect(accountBalance(inv, s.txns, s.snapshots)).toBe(last.balanceC + 500000);
    expect(buildLongTerm(s, null).rows[0].netWorthC).toBe(overviewNetWorth(s));
  });
});

/* ============================================================
   monthlyPayment
   ============================================================ */
describe("monthlyPayment", () => {
  it("computes a standard amortising payment", () => {
    expect(monthlyPayment(185000000, 10.5, 216)).toBe(1909621);
    expect(monthlyPayment(1000000, 12, 12)).toBe(88849);
  });

  it("divides the balance evenly in the zero-interest branch", () => {
    expect(monthlyPayment(120000000, 0, 240)).toBe(500000);
    expect(monthlyPayment(100000, 0, 3)).toBe(33333); // rounded
  });

  it("returns 0 when termMonths is zero or negative", () => {
    expect(monthlyPayment(100000, 5, 0)).toBe(0);
    expect(monthlyPayment(100000, 5, -3)).toBe(0);
    expect(monthlyPayment(100000, 0, 0)).toBe(0); // guard precedes the zero-rate branch
  });

  it("returns an integer number of cents", () => {
    expect(Number.isInteger(monthlyPayment(185000000, 10.5, 216))).toBe(true);
    expect(Number.isInteger(monthlyPayment(120000000, 0, 240))).toBe(true);
  });
});

/* ============================================================
   amortise
   ============================================================ */
describe("amortise", () => {
  freezeNow();

  it("labels rows with consecutive months starting at the current month", () => {
    const { rows } = amortise({ balanceC: 1000000, ratePct: 0, termMonths: 10 }, 3);
    expect(rows.map((r) => r.ym)).toEqual(["2026-03", "2026-04", "2026-05"]);
  });

  it("pays a zero-interest loan off exactly over its term", () => {
    const { rows, paymentC } = amortise({ balanceC: 1000000, ratePct: 0, termMonths: 10 }, 24);
    expect(paymentC).toBe(100000);
    expect(rows).toHaveLength(10); // stops early once the balance hits zero
    expect(rows[rows.length - 1].balanceC).toBe(0);
    expect(rows.reduce((s, r) => s + r.principalC, 0)).toBe(1000000);
    expect(rows.every((r) => r.interestC === 0)).toBe(true);
  });

  it("keeps paymentC equal to interest plus principal on every row", () => {
    const { rows } = amortise({ balanceC: 10000000, ratePct: 12, termMonths: 60 }, 6);
    rows.forEach((r) => expect(r.paymentC).toBe(r.interestC + r.principalC));
  });

  it("splits an interest-bearing payment into interest and principal", () => {
    const { rows, paymentC } = amortise({ balanceC: 10000000, ratePct: 12, termMonths: 60 }, 3);
    expect(paymentC).toBe(222444);
    expect(rows[0]).toMatchObject({ interestC: 100000, principalC: 122444, balanceC: 9877556 });
    expect(rows[1]).toMatchObject({ interestC: 98776, principalC: 123668, balanceC: 9753888 });
    // interest falls and principal rises as the balance amortises
    expect(rows[1].interestC).toBeLessThan(rows[0].interestC);
    expect(rows[1].principalC).toBeGreaterThan(rows[0].principalC);
  });

  it("uses paymentOverrideC in preference to the computed payment", () => {
    const { paymentC } = amortise(
      { balanceC: 10000000, ratePct: 12, termMonths: 60, paymentOverrideC: 300000 },
      1,
    );
    expect(paymentC).toBe(300000);
  });

  it("uses rateOverridePct in preference to the mortgage rate", () => {
    const withOverride = amortise({ balanceC: 10000000, ratePct: 12, termMonths: 60 }, 1, 0);
    expect(withOverride.rows[0].interestC).toBe(0);
    expect(withOverride.paymentC).toBe(monthlyPayment(10000000, 0, 60));
  });

  it("stops at the requested number of months for a long loan", () => {
    const { rows } = amortise({ balanceC: 185000000, ratePct: 10.5, termMonths: 216 }, 5);
    expect(rows).toHaveLength(5);
    expect(rows[4].balanceC).toBeGreaterThan(0);
  });

  it("clamps a sub-R10 residual balance to zero, forgiving the tail", () => {
    // 99999 - 3 x 33000 = 999 remaining, which is under the 1000c (R10) clamp
    const { rows } = amortise(
      { balanceC: 99999, ratePct: 0, termMonths: 10, paymentOverrideC: 33000 },
      12,
    );
    expect(rows).toHaveLength(3);
    expect(rows[1].balanceC).toBe(33999);
    expect(rows[2].balanceC).toBe(0);
    // the clamp writes off the 999c tail: principal paid is short of the opening balance
    expect(rows.reduce((s, r) => s + r.principalC, 0)).toBe(99000);
  });

  it("does not clamp when the balance amortises exactly", () => {
    const { rows } = amortise(
      { balanceC: 99000, ratePct: 0, termMonths: 10, paymentOverrideC: 33000 },
      12,
    );
    expect(rows).toHaveLength(3);
    expect(rows[rows.length - 1].balanceC).toBe(0);
    expect(rows.reduce((s, r) => s + r.principalC, 0)).toBe(99000);
  });
});

/* ============================================================
   matchRecurring / matchAnnual
   ============================================================ */
describe("matchRecurring", () => {
  const cats = [{ id: "c_x", kind: "expense" }];
  const tx = (amountC, over = {}) => ({
    categoryId: "c_x", date: "2026-03-10", amountC, ...over,
  });
  const item = { categoryId: "c_x", amountC: -280000 }; // 10% = 28000c, above the 10000c floor
  const small = { categoryId: "c_x", amountC: -50000 }; // 10% = 5000c, so the 10000c floor applies

  it("reports unpaid when nothing matches", () => {
    expect(matchRecurring(item, [], "2026-03", cats)).toMatchObject({
      actualC: 0, paid: false, varianceC: 0, material: false, hits: [],
    });
  });

  it("reports a paid item with zero variance on an exact match", () => {
    const m = matchRecurring(item, [tx(-280000)], "2026-03", cats);
    expect(m.paid).toBe(true);
    expect(m.actualC).toBe(-280000);
    expect(m.varianceC).toBe(0);
    expect(m.material).toBe(false);
  });

  it("sums multiple hits in the month", () => {
    const m = matchRecurring(item, [tx(-140000), tx(-140000)], "2026-03", cats);
    expect(m.hits).toHaveLength(2);
    expect(m.actualC).toBe(-280000);
    expect(m.varianceC).toBe(0);
  });

  it("is not material at exactly the 10% threshold", () => {
    const m = matchRecurring(item, [tx(-308000)], "2026-03", cats);
    expect(m.varianceC).toBe(-28000);
    expect(m.material).toBe(false); // strict >, so the boundary is not material
  });

  it("is material one cent past the 10% threshold", () => {
    const m = matchRecurring(item, [tx(-308001)], "2026-03", cats);
    expect(m.varianceC).toBe(-28001);
    expect(m.material).toBe(true);
  });

  it("applies the 10000c floor when 10% of the item is smaller", () => {
    expect(matchRecurring(small, [tx(-60000)], "2026-03", cats).material).toBe(false);
    expect(matchRecurring(small, [tx(-60001)], "2026-03", cats).material).toBe(true);
  });

  it("ignores transactions in other months", () => {
    const m = matchRecurring(item, [tx(-280000, { date: "2026-02-10" })], "2026-03", cats);
    expect(m.paid).toBe(false);
    expect(m.hits).toHaveLength(0);
  });

  it("ignores excluded transactions", () => {
    const m = matchRecurring(item, [tx(-280000, { excluded: true })], "2026-03", cats);
    expect(m.paid).toBe(false);
  });

  it("ignores transactions in other categories", () => {
    const m = matchRecurring(item, [tx(-280000, { categoryId: "c_other" })], "2026-03", cats);
    expect(m.paid).toBe(false);
  });
});

describe("matchAnnual", () => {
  const tx = (amountC, over = {}) => ({
    categoryId: "c_x", date: "2026-03-10", amountC, ...over,
  });
  const item = { categoryId: "c_x", amountC: -120000, month: 3 };

  it("builds the target ym from the year and the item month, zero-padded", () => {
    expect(matchAnnual({ categoryId: "c_x", amountC: -1, month: 7 }, [], 2026).ym).toBe("2026-07");
    expect(matchAnnual(item, [], 2026).ym).toBe("2026-03");
  });

  it("reports a hit with its variance", () => {
    expect(matchAnnual(item, [tx(-130000)], 2026)).toMatchObject({
      ym: "2026-03", actualC: -130000, paid: true, varianceC: -10000,
    });
  });

  it("reports zero variance when unpaid", () => {
    expect(matchAnnual(item, [], 2026)).toMatchObject({
      actualC: 0, paid: false, varianceC: 0,
    });
  });

  it("ignores excluded and out-of-month transactions", () => {
    expect(matchAnnual(item, [tx(-130000, { excluded: true })], 2026).paid).toBe(false);
    expect(matchAnnual(item, [tx(-130000, { date: "2026-04-10" })], 2026).paid).toBe(false);
    expect(matchAnnual(item, [tx(-130000)], 2027).paid).toBe(false);
  });
});

/* ============================================================
   buildForecast
   ============================================================ */
describe("buildForecast", () => {
  freezeNow();

  const cats = [
    { id: "cat_salary", kind: "income" },
    { id: "cat_bonus", kind: "income" },
    { id: "c_food", kind: "expense" },
    { id: "c_ins", kind: "expense" },
    { id: "c_tr", kind: "transfer" },
  ];
  const baseState = () => ({
    categories: cats,
    recurring: [
      { id: "r1", categoryId: "cat_salary", amountC: 1000000, day: 25 },
      { id: "r2", categoryId: "c_food", amountC: -300000, day: 1 },
      { id: "r3", categoryId: "c_tr", amountC: -100000, day: 2 },
    ],
    annual: [{ id: "a1", categoryId: "c_ins", amountC: -120000, month: 6, escalationPct: 10 }],
    txns: [],
    comp: { salaryMonthlyC: 1000000, bonusTargetPct: 0, bonusMonth: 12, salaryGrowthPct: 0 },
    mortgage: { balanceC: 0, ratePct: 10, termMonths: 0, paymentOverrideC: 0 },
  });
  const flat = { salaryPct: 0, spendPct: 0, inflationDelta: 0, rateDelta: 0, returnDelta: 0 };
  const modes = (f) => f.rows.map((r) => r.mode);

  it("returns 12 consecutive months starting at the current month", () => {
    const { rows } = buildForecast(baseState(), null);
    expect(rows).toHaveLength(12);
    expect(rows.map((r) => r.ym)).toEqual([
      "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08",
      "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02",
    ]);
  });

  /* ---- mode selection ---- */
  it("uses plan mode for every month when there are no transactions", () => {
    expect(modes(buildForecast(baseState(), null))).toEqual(Array(12).fill("plan"));
  });

  it("switches the current month to blend mode when it has actuals", () => {
    const s = baseState();
    s.txns = [{ id: "t1", date: "2026-03-05", amountC: -350000, categoryId: "c_food" }];
    expect(modes(buildForecast(s, null))).toEqual(["blend", ...Array(11).fill("plan")]);
  });

  it("leaves future months in plan mode even when they contain transactions", () => {
    const s = baseState();
    s.txns = [{ id: "t9", date: "2026-05-05", amountC: -999999, categoryId: "c_food" }];
    const { rows } = buildForecast(s, null);
    expect(modes({ rows })).toEqual(Array(12).fill("plan"));
    // the actuals are still reported, they are just not used
    expect(rows[2].actOut).toBe(-999999);
    expect(rows[2].usedOut).toBe(-300000);
    expect(rows[2].varianceC).toBe(0);
  });

  it("ignores transactions before the current month — elapsed months are outside the window", () => {
    const s = baseState();
    s.txns = [{ id: "t8", date: "2026-01-05", amountC: -111, categoryId: "c_food" }];
    const { rows } = buildForecast(s, null);
    // the window starts at the current month, so January is never iterated at all
    expect(rows[0].ym).toBe("2026-03");
    expect(rows.some((r) => r.ym < "2026-03")).toBe(false);
    expect(modes({ rows })).toEqual(Array(12).fill("plan"));
    // a past transaction changes nothing about the forecast
    expect(rows).toEqual(buildForecast(baseState(), null).rows);
  });

  it("only ever produces plan and blend modes", () => {
    const s = baseState();
    s.txns = [
      { id: "p1", date: "2026-01-05", amountC: -111, categoryId: "c_food" },
      { id: "c1", date: "2026-03-05", amountC: -350000, categoryId: "c_food" },
      { id: "f1", date: "2026-07-05", amountC: -999, categoryId: "c_food" },
    ];
    buildForecast(s, null).rows.forEach((r) => {
      expect(["plan", "blend"]).toContain(r.mode);
    });
  });

  it("does not blend on excluded or transfer-category transactions alone", () => {
    const excluded = baseState();
    excluded.txns = [{ id: "t7", date: "2026-03-05", amountC: -111, categoryId: "c_food", excluded: true }];
    expect(modes(buildForecast(excluded, null))).toEqual(Array(12).fill("plan"));

    const transferCat = baseState();
    transferCat.txns = [{ id: "t6", date: "2026-03-05", amountC: -111, categoryId: "c_tr" }];
    expect(modes(buildForecast(transferCat, null))).toEqual(Array(12).fill("plan"));

    const transferFlag = baseState();
    transferFlag.txns = [{ id: "t5", date: "2026-03-05", amountC: -111, categoryId: "c_food", transfer: true }];
    expect(modes(buildForecast(transferFlag, null))).toEqual(Array(12).fill("plan"));
  });

  /* ---- plan arithmetic ---- */
  it("excludes transfer-category recurring items from planned flows", () => {
    const { rows } = buildForecast(baseState(), null);
    // the -100000 transfer recurring item is not in planOut
    expect(rows[0].planIn).toBe(1000000);
    expect(rows[0].planOut).toBe(-300000);
    expect(rows[0].planNet).toBe(700000);
  });

  it("adds annual items in their month only", () => {
    const { rows } = buildForecast(baseState(), null);
    expect(rows[3].ym).toBe("2026-06");
    expect(rows[3].planOut).toBe(-420000); // -300000 recurring + -120000 annual
    expect(rows[4].planOut).toBe(-300000);
  });

  it("accumulates cum across the 12 months", () => {
    const { rows } = buildForecast(baseState(), null);
    expect(rows[0].cum).toBe(rows[0].net);
    rows.forEach((r, i) => {
      if (i > 0) expect(r.cum).toBe(rows[i - 1].cum + r.net);
    });
  });

  /* ---- blend arithmetic ---- */
  it("blends matched actuals with plan for still-pending items", () => {
    const s = baseState();
    s.txns = [
      { id: "t1", date: "2026-03-05", amountC: -350000, categoryId: "c_food" },
      { id: "t2", date: "2026-03-25", amountC: 1000000, categoryId: "cat_salary" },
      { id: "t3", date: "2026-03-06", amountC: -100000, categoryId: "c_tr" },
      { id: "t4", date: "2026-03-07", amountC: -50000, categoryId: "c_unmodelled" },
    ];
    const row = buildForecast(s, null).rows[0];
    expect(row.mode).toBe("blend");
    expect(row.usedIn).toBe(1000000);
    // -350000 matched food actual, plus -50000 unplanned; the transfer is excluded
    expect(row.usedOut).toBe(-400000);
    expect(row.net).toBe(600000);
    expect(row.varianceC).toBe(row.net - row.planNet);
    expect(row.varianceC).toBe(-100000);
  });

  it("falls back to the planned amount for recurring items with no actual yet", () => {
    const s = baseState();
    // only food has an actual; salary has not landed
    s.txns = [{ id: "t1", date: "2026-03-05", amountC: -350000, categoryId: "c_food" }];
    const row = buildForecast(s, null).rows[0];
    expect(row.mode).toBe("blend");
    expect(row.usedIn).toBe(1000000); // planned salary still counted
    expect(row.usedOut).toBe(-350000); // actual food
  });

  /* ---- scenario ---- */
  it("applies salaryPct to the salary line", () => {
    const plain = buildForecast(baseState(), flat).rows[0].planIn;
    const raised = buildForecast(baseState(), { ...flat, salaryPct: 10 }).rows[0].planIn;
    expect(plain).toBe(1000000);
    expect(raised).toBe(1100000);
  });

  it("applies spendPct to negative recurring lines", () => {
    const plain = buildForecast(baseState(), flat).rows[0].planOut;
    const raised = buildForecast(baseState(), { ...flat, spendPct: 20 }).rows[0].planOut;
    expect(plain).toBe(-300000);
    expect(raised).toBe(-360000);
  });

  it("defaults to a flat scenario when passed null", () => {
    expect(buildForecast(baseState(), null).rows).toEqual(buildForecast(baseState(), flat).rows);
  });

  /* ---- mortgage payment ---- */
  it("keeps paymentOverrideC as the mortgage payment when rateDelta is zero", () => {
    const s = baseState();
    s.mortgage = { balanceC: 100000000, ratePct: 10, termMonths: 240, paymentOverrideC: 900000 };
    expect(buildForecast(s, null).mortPay).toBe(900000);
  });

  it("recomputes the mortgage payment from the shifted rate when rateDelta is non-zero", () => {
    const s = baseState();
    s.mortgage = { balanceC: 100000000, ratePct: 10, termMonths: 240, paymentOverrideC: 900000 };
    const shifted = buildForecast(s, { ...flat, rateDelta: 1 }).mortPay;
    expect(shifted).toBe(monthlyPayment(100000000, 11, 240));
    expect(shifted).toBe(1032188);
  });

  it("computes the mortgage payment when there is no override", () => {
    const s = baseState();
    s.mortgage = { balanceC: 100000000, ratePct: 10, termMonths: 240, paymentOverrideC: 0 };
    expect(buildForecast(s, null).mortPay).toBe(monthlyPayment(100000000, 10, 240));
  });

  it("uses the mortgage payment, not the recurring amount, for the mortgage line", () => {
    const s = baseState();
    s.mortgage = { balanceC: 100000000, ratePct: 10, termMonths: 240, paymentOverrideC: 900000 };
    s.recurring.push({ id: "r4", categoryId: "cat_mortgage", amountC: -1, day: 1 });
    expect(buildForecast(s, null).rows[0].planOut).toBe(-1200000); // -300000 food + -900000 bond
  });

  /* ---- bonus ---- */
  it("adds the bonus in the configured bonus month", () => {
    const s = baseState();
    s.comp = { ...s.comp, bonusTargetPct: 20, bonusMonth: 12 };
    const { rows } = buildForecast(s, null);
    const dec = rows.find((r) => r.ym === "2026-12");
    const nov = rows.find((r) => r.ym === "2026-11");
    expect(nov.planIn).toBe(1000000);
    expect(dec.planIn).toBe(3400000); // 1000000 salary + 1000000 * 12 * 20%
  });

  /* The bonus is added to planIn on its own, outside the recurring sweep, so a
     blend that rebuilt usedIn from the recurring and annual items alone lost
     it: one transaction in the bonus month and the bonus fell out of net and
     cum, and the variance called it a shortfall the size of the bonus. */
  it("keeps the bonus in the blend when the bonus month is the current month", () => {
    const s = baseState();
    s.comp = { ...s.comp, bonusTargetPct: 20, bonusMonth: 3 };
    s.txns = [{ id: "t1", date: "2026-03-05", amountC: -350000, categoryId: "c_food" }];
    const row = buildForecast(s, null).rows[0];
    expect(row.mode).toBe("blend");
    expect(row.planIn).toBe(3400000);
    expect(row.usedIn).toBe(3400000); // planned salary and planned bonus, neither of them paid yet
    expect(row.net).toBe(3050000);    // 3400000 in, 350000 of actual food out
    expect(row.varianceC).toBe(-50000); // the food overspend alone, not the whole bonus
  });

  it("takes the bonus that was actually paid over the bonus the plan assumed", () => {
    const s = baseState();
    s.comp = { ...s.comp, bonusTargetPct: 20, bonusMonth: 3 };
    s.txns = [
      { id: "t1", date: "2026-03-05", amountC: -350000, categoryId: "c_food" },
      { id: "t2", date: "2026-03-10", amountC: 2000000, categoryId: "cat_bonus" },
    ];
    const row = buildForecast(s, null).rows[0];
    // 1000000 planned salary + the 2000000 that landed, not that plus the 2400000 assumed
    expect(row.usedIn).toBe(3000000);
  });
});

/* ============================================================
   buildLongTerm
   ============================================================ */
describe("buildLongTerm", () => {
  freezeNow();

  const cats = [{ id: "c_food", kind: "expense" }];
  const baseState = () => ({
    settings: {
      currency: "R", currentAge: 60, retirementAge: 62, planningAge: 64,
      inflationPct: 0, investReturnPct: 0, cashReturnPct: 0, cryptoReturnPct: 0,
    },
    comp: { salaryMonthlyC: 1000000, bonusTargetPct: 0, bonusMonth: 12, salaryGrowthPct: 0 },
    mortgage: { balanceC: 0, ratePct: 0, termMonths: 0, paymentOverrideC: 0, propertyValueC: 0 },
    recurring: [{ id: "r2", categoryId: "c_food", amountC: -100000, day: 1 }],
    annual: [],
    accounts: [{ id: "a1", type: "bank", openingC: 5000000 }],
    txns: [], snapshots: [], categories: cats,
  });

  it("emits one row per year from currentAge through planningAge inclusive", () => {
    const { rows } = buildLongTerm(baseState(), null);
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r.age)).toEqual([60, 61, 62, 63, 64]);
    expect(rows.map((r) => r.year)).toEqual([2026, 2027, 2028, 2029, 2030]);
  });

  it("marks retirement at retirementAge and drops income to zero", () => {
    const { rows } = buildLongTerm(baseState(), null);
    expect(rows.map((r) => r.retired)).toEqual([false, false, true, true, true]);
    expect(rows[0].incomeC).toBe(12000000); // 1000000 x 12, no bonus
    expect(rows[2].incomeC).toBe(0);
  });

  it("annualises recurring spend and nets it against income", () => {
    const { rows } = buildLongTerm(baseState(), null);
    expect(rows[0].spendC).toBe(1200000); // 100000 x 12
    expect(rows[0].netC).toBe(10800000);
    expect(rows[2].netC).toBe(-1200000); // retired, spend only
  });

  it("rolls the cash balance forward by the net each year", () => {
    const { rows } = buildLongTerm(baseState(), null);
    expect(rows[0].cashC).toBe(5000000); // the opening balance, untouched
    // a row's net is the year that follows it, so it lands on the row below
    rows.forEach((r, i) => {
      if (i > 0) expect(r.cashC).toBe(rows[i - 1].cashC + rows[i - 1].netC);
    });
  });

  /* The first row is where the plan starts from, not a year into it. The chart
     above it is captioned "starts from your balances today", and it has to be
     the figures the rest of the app shows for today: no growth, no year of
     spending, no mortgage payments, no property revaluation. */
  it("opens on the balances held today, before any growth or spending", () => {
    const s = baseState();
    s.settings = { ...s.settings, inflationPct: 10, investReturnPct: 10, cashReturnPct: 10, cryptoReturnPct: 10 };
    s.mortgage = { balanceC: 10000000, ratePct: 12, termMonths: 240, paymentOverrideC: 200000, propertyValueC: 40000000 };
    s.accounts = [
      { id: "a1", type: "bank", openingC: 5000000 },
      { id: "a2", type: "investment", openingC: 8000000 },
      { id: "a3", type: "crypto", openingC: 300000 },
    ];
    const { rows } = buildLongTerm(s, null);
    expect(rows[0].age).toBe(60);
    expect(rows[0].year).toBe(2026);
    expect(rows[0].cashC).toBe(5000000);
    expect(rows[0].investC).toBe(8000000);
    expect(rows[0].cryptoC).toBe(300000);
    expect(rows[0].propertyC).toBe(40000000);
    expect(rows[0].mortC).toBe(10000000);
    expect(rows[0].liquidC).toBe(13300000);
    expect(rows[0].netWorthC).toBe(43300000); // 13300000 liquid + 40000000 property - 10000000 owed
  });

  /* One year of compounding per year of the horizon. Sixty to sixty-two is two
     years, so the last row carries two, not three. */
  it("compounds once per year of the horizon and stops at the planning age", () => {
    const s = baseState();
    s.settings = { ...s.settings, retirementAge: 60, planningAge: 62, investReturnPct: 10 };
    s.comp = { ...s.comp, salaryMonthlyC: 0 };
    s.recurring = [];
    s.accounts = [{ id: "a1", type: "investment", openingC: 1000000 }];
    const { rows } = buildLongTerm(s, null);
    expect(rows.map((r) => r.age)).toEqual([60, 61, 62]);
    expect(rows.map((r) => r.investC)).toEqual([1000000, 1100000, 1210000]); // x1.1^0, ^1, ^2
  });

  /* Twelve months of amortisation per year of the horizon, no more: the
     balance on a row is what is owed at that age. R250 a month against an
     interest-free R12,000 clears it in the fourth year, not the third. */
  it("amortises the mortgage twelve months for each year of the horizon", () => {
    const s = baseState();
    s.mortgage = { balanceC: 1200000, ratePct: 0, termMonths: 48, paymentOverrideC: 25000, propertyValueC: 0 };
    const { rows } = buildLongTerm(s, null);
    expect(rows.map((r) => r.mortC)).toEqual([1200000, 900000, 600000, 300000, 0]);
    expect(rows.map((r) => r.spendC)).toEqual([1500000, 1500000, 1500000, 1500000, 1200000]);
  });

  it("reports no depletion while liquid assets remain positive", () => {
    expect(buildLongTerm(baseState(), null).depletionAge).toBeNull();
  });

  it("records a depletion age once liquid assets run out in retirement", () => {
    const s = baseState();
    s.accounts = [{ id: "a1", type: "bank", openingC: 100000 }];
    s.settings = { ...s.settings, retirementAge: 60 };
    const { rows, depletionAge } = buildLongTerm(s, null);
    expect(rows[0].liquidC).toBe(100000); // still R1,000 today
    expect(depletionAge).toBe(61); // spent by the following year
    expect(rows[1].liquidC).toBeLessThanOrEqual(0);
  });

  /* The age the warning names has to be an age the table can be read at: the
     row for it shows the shortfall, and the row above it still has something
     left. Anything else and the banner points at a year that still has money
     in it. */
  it("names an age whose own row shows the shortfall, the year before it solvent", () => {
    [{ openingC: 100000, retirementAge: 60 }, { openingC: 5000000, retirementAge: 61 }].forEach((c) => {
      const s = baseState();
      s.accounts = [{ id: "a1", type: "bank", openingC: c.openingC }];
      s.settings = { ...s.settings, retirementAge: c.retirementAge, planningAge: 75 };
      s.comp = { ...s.comp, salaryMonthlyC: 0 };
      const { rows, depletionAge } = buildLongTerm(s, null);
      const at = rows.findIndex((r) => r.age === depletionAge);
      expect(at).toBeGreaterThan(0);
      expect(rows[at].liquidC).toBeLessThanOrEqual(0);
      expect(rows[at - 1].liquidC).toBeGreaterThan(0);
    });
  });

  /* The model somebody has just reset: every figure zero. Nothing ran out,
     because nothing was ever there, and the Long-Term page must not say it did. */
  it("reports no depletion for a model with nothing in it, nothing having run out", () => {
    const s = baseState();
    s.accounts = [{ id: "a1", type: "bank", openingC: 0 }];
    s.comp = { ...s.comp, salaryMonthlyC: 0 };
    s.recurring = [];
    const { rows, depletionAge } = buildLongTerm(s, null);
    expect(rows.every((r) => r.liquidC === 0)).toBe(true);
    expect(rows.some((r) => r.retired)).toBe(true);
    expect(depletionAge).toBeNull();
  });

  /* Assets do not have to be there on day one to count as having existed:
     saved out of salary and then spent in retirement is a real depletion. */
  it("records a depletion age for assets built up while working and then spent", () => {
    const s = baseState();
    s.accounts = [{ id: "a1", type: "bank", openingC: 0 }];
    s.recurring = [{ id: "r2", categoryId: "c_food", amountC: -900000, day: 1 }];
    const { rows, depletionAge } = buildLongTerm(s, null);
    expect(rows[0].liquidC).toBe(0); // nothing today
    expect(rows[1].liquidC).toBeGreaterThan(0); // a year of working has put some by
    expect(depletionAge).toBe(63);
  });
});

/* ============================================================
   parseOFX
   ============================================================ */
describe("parseOFX", () => {
  it("extracts transactions from STMTTRN blocks", () => {
    const ofx =
      "<STMTTRN><DTPOSTED>20260715120000<TRNAMT>-123.45<NAME>SHELL</STMTTRN>" +
      "<STMTTRN><DTPOSTED>20260716<TRNAMT>500.00<MEMO>SALARY</STMTTRN>";
    expect(parseOFX(ofx)).toEqual([
      { date: "2026-07-15", desc: "SHELL", amountC: -12345 },
      { date: "2026-07-16", desc: "SALARY", amountC: 50000 },
    ]);
  });

  it("returns an empty array when there are no STMTTRN blocks", () => {
    expect(parseOFX("<OFX></OFX>")).toEqual([]);
  });

  it("falls back to a default description when NAME and MEMO are absent", () => {
    const ofx = "<STMTTRN><DTPOSTED>20260101<TRNAMT>1.00</STMTTRN>";
    expect(parseOFX(ofx)).toEqual([
      { date: "2026-01-01", desc: "OFX transaction", amountC: 100 },
    ]);
  });

  it("skips blocks whose date will not parse", () => {
    const ofx = "<STMTTRN><TRNAMT>1.00<NAME>NO DATE</STMTTRN>";
    expect(parseOFX(ofx)).toEqual([]);
  });
});

/* ============================================================
   blankState — the empty model behind Reset
   ============================================================ */
describe("blankState", () => {
  freezeNow();

  const EMPTIED = ["recurring", "annual", "rules", "txns", "snapshots", "batches", "audit"];

  it("carries exactly the keys the seeded model carries", () => {
    expect(Object.keys(blankState).sort()).toEqual(Object.keys(initialState).sort());
  });

  it("empties every array the user puts their own data into", () => {
    EMPTIED.forEach((key) => {
      expect(blankState[key], key).toEqual([]);
    });
  });

  it("shares no array with the seeded model, so an edit to one cannot reach the other", () => {
    Object.keys(initialState)
      .filter((key) => Array.isArray(initialState[key]))
      .forEach((key) => {
        expect(blankState[key], key).not.toBe(initialState[key]);
      });
  });

  it("keeps the accounts, because nothing in the app can create one", () => {
    expect(blankState.accounts).toHaveLength(initialState.accounts.length);
    expect(blankState.accounts.map((a) => a.id)).toEqual(initialState.accounts.map((a) => a.id));
  });

  it("zeroes the opening figure on every account it keeps", () => {
    blankState.accounts.forEach((a) => {
      expect(a.openingC, a.id).toBe(0);
    });
  });

  it("keeps the category list whole, including the hardcoded fallbacks", () => {
    expect(blankState.categories.map((c) => c.id)).toEqual(initialState.categories.map((c) => c.id));
    expect(blankState.categories.some((c) => c.id === "cat_uncat")).toBe(true);
    expect(blankState.categories.some((c) => c.id === "cat_general")).toBe(true);
  });

  it("zeroes the compensation and the mortgage", () => {
    expect(blankState.comp.salaryMonthlyC).toBe(0);
    expect(blankState.comp.bonusTargetPct).toBe(0);
    expect(blankState.comp.salaryGrowthPct).toBe(0);
    expect(blankState.mortgage.balanceC).toBe(0);
    expect(blankState.mortgage.ratePct).toBe(0);
    expect(blankState.mortgage.propertyValueC).toBe(0);
    expect(blankState.mortgage.paymentOverrideC).toBe(0);
  });

  it("zeroes inflation and every return rate", () => {
    expect(blankState.settings.inflationPct).toBe(0);
    expect(blankState.settings.investReturnPct).toBe(0);
    expect(blankState.settings.cashReturnPct).toBe(0);
    expect(blankState.settings.cryptoReturnPct).toBe(0);
  });

  it("holds ages the settings form would accept", () => {
    const st = blankState.settings;
    expect(ageError("currentAge", st.currentAge, st)).toBeNull();
    expect(ageError("retirementAge", st.retirementAge, st)).toBeNull();
    expect(ageError("planningAge", st.planningAge, st)).toBeNull();
  });

  it("leaves the scenario switched off with no deltas", () => {
    expect(blankState.scenario).toEqual({ enabled: false, salaryPct: 0, spendPct: 0, inflationDelta: 0, rateDelta: 0, returnDelta: 0 });
  });

  it("works out a mortgage payment of zero rather than dividing by a zero term", () => {
    const m = blankState.mortgage;
    expect(monthlyPayment(m.balanceC, m.ratePct, m.termMonths)).toBe(0);
    expect(amortise(m, m.termMonths).rows).toEqual([]);
  });

  it("reports a zero balance for every account it holds", () => {
    blankState.accounts.forEach((a) => {
      expect(accountBalance(a, blankState.txns, blankState.snapshots), a.id).toBe(0);
    });
  });

  it("forecasts twelve months of nothing without throwing", () => {
    const { rows } = buildForecast(blankState, null);
    expect(rows).toHaveLength(12);
    rows.forEach((r) => {
      expect(r.planIn).toBe(0);
      expect(r.planOut).toBe(0);
      expect(r.usedIn).toBe(0);
      expect(r.usedOut).toBe(0);
      expect(r.net).toBe(0);
      expect(r.cum).toBe(0);
      expect(r.mode).toBe("plan");
    });
  });

  it("projects the long term as one row per year of zeros, without throwing", () => {
    const st = blankState.settings;
    const { rows } = buildLongTerm(blankState, null);
    expect(rows).toHaveLength(st.planningAge - st.currentAge + 1);
    rows.forEach((r) => {
      expect(r.incomeC).toBe(0);
      expect(r.spendC).toBe(0);
      expect(r.netC).toBe(0);
      expect(r.cashC).toBe(0);
      expect(r.investC).toBe(0);
      expect(r.cryptoC).toBe(0);
      expect(r.mortC).toBe(0);
      expect(r.netWorthC).toBe(0);
    });
  });

  /* This is the model somebody is looking at seconds after pressing Reset.
     With nothing saved and nothing coming in there is nothing to run out, so
     neither the Overview nor the Long-Term page may claim the assets were
     exhausted at the retirement age. */
  it("reports no depletion age, there being nothing that could have run out", () => {
    expect(buildLongTerm(blankState, null).depletionAge).toBeNull();
  });
});

/* ============================================================
   uid — ids that do not collide with a saved model
   ============================================================ */
describe("uid", () => {
  const UUID_ID = /^[a-z]+_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it("gives a different id every time it is asked", () => {
    const ids = new Set();
    for (let i = 0; i < 20000; i++) ids.add(uid("txn"));
    expect(ids.size).toBe(20000);
  });

  it("keeps the type prefix in front of the id", () => {
    expect(uid("txn")).toMatch(/^txn_/);
    expect(uid("batch")).toMatch(/^batch_/);
  });

  it("mints a version-4 uuid", () => {
    expect(uid("rec")).toMatch(UUID_ID);
  });

  /* randomUUID needs a secure context, which Safari before 15.4 has not got.
     Take it away and the hand-rolled fallback has to produce the same thing. */
  it("still mints distinct v4 ids where randomUUID is missing", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (a) => real.getRandomValues(a) });
    try {
      expect(globalThis.crypto.randomUUID).toBeUndefined();
      const ids = new Set();
      for (let i = 0; i < 2000; i++) {
        const id = uid("txn");
        expect(id).toMatch(UUID_ID);
        ids.add(id);
      }
      expect(ids.size).toBe(2000);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not hand back an id the seeded model is already using", () => {
    const seeded = new Set(
      [...initialState.txns, ...initialState.recurring, ...initialState.annual,
       ...initialState.rules, ...initialState.snapshots, ...initialState.audit].map((r) => r.id)
    );
    for (let i = 0; i < 1000; i++) expect(seeded.has(uid("txn"))).toBe(false);
  });
});

/* ============================================================
   hydrate — repairing a saved model on the way in
   ============================================================ */
describe("hydrate", () => {
  freezeNow();

  /* A saved blob is the whole model as JSONB, so start from a copy of one and
     damage it in the one way each test is about. */
  const savedBlob = (damage = {}) => ({ ...structuredClone(initialState), ...damage });
  const drop = (key) => { const b = savedBlob(); delete b[key]; return b; };

  it("fills a top-level key the saved model has not got", () => {
    const st = hydrate(drop("scenario"));
    expect(st.scenario).toEqual(initialState.scenario);
  });

  it("fills every top-level key, one at a time, whichever one is missing", () => {
    Object.keys(initialState).forEach((key) => {
      const st = hydrate(drop(key));
      expect(st[key], key).not.toBeUndefined();
    });
  });

  it("fills a missing sub-key of settings, comp, mortgage and scenario", () => {
    const b = savedBlob();
    delete b.settings.theme;         // absent on rows saved before the theme existed
    delete b.mortgage.propertyValueC; // absent on rows saved before the property figure existed
    delete b.comp.salaryGrowthPct;
    delete b.scenario.rateDelta;
    const st = hydrate(b);
    expect(st.settings.theme).toBe(initialState.settings.theme);
    expect(st.mortgage.propertyValueC).toBe(initialState.mortgage.propertyValueC);
    expect(st.comp.salaryGrowthPct).toBe(initialState.comp.salaryGrowthPct);
    expect(st.scenario.rateDelta).toBe(initialState.scenario.rateDelta);
  });

  it("keeps what the saved model did say while filling what it did not", () => {
    const st = hydrate(savedBlob({ settings: { currency: "£", currentAge: 51 } }));
    expect(st.settings.currency).toBe("£");
    expect(st.settings.currentAge).toBe(51);
    expect(st.settings.inflationPct).toBe(initialState.settings.inflationPct);
  });

  it("leaves a key it has never heard of exactly where it found it", () => {
    const st = hydrate(savedBlob({ goals: [{ id: "g1", name: "New roof" }], nickname: "Alex" }));
    expect(st.goals).toEqual([{ id: "g1", name: "New roof" }]);
    expect(st.nickname).toBe("Alex");
  });

  it("puts an array back where something that is not an array was saved", () => {
    [null, {}, "txns", 7].forEach((junk) => {
      const st = hydrate(savedBlob({ accounts: junk }));
      expect(Array.isArray(st.accounts), String(junk)).toBe(true);
      expect(st.accounts.map((a) => a.id)).toEqual(initialState.accounts.map((a) => a.id));
    });
  });

  it("shares no row with the seeded model when it replaces an array", () => {
    const st = hydrate(savedBlob({ accounts: null }));
    expect(st.accounts).not.toBe(initialState.accounts);
    st.accounts.forEach((a, i) => expect(a).not.toBe(initialState.accounts[i]));
  });

  it("stamps the schema version on, over whatever was saved there", () => {
    expect(hydrate(drop("schemaVersion")).schemaVersion).toBe(SCHEMA_VERSION);
    expect(hydrate(savedBlob({ schemaVersion: 0 })).schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("takes a blob that is not a model at all rather than throwing", () => {
    [null, undefined, "nonsense", 42, []].forEach((junk) => {
      expect(hydrate(junk).settings, String(junk)).toEqual(initialState.settings);
    });
  });

  it("remints a duplicate id, keeping it for the row that claimed it first", () => {
    const twin = { ...initialState.txns[0] };
    const st = hydrate(savedBlob({ txns: [initialState.txns[0], twin] }));
    expect(st.txns[0].id).toBe(initialState.txns[0].id);
    expect(st.txns[1].id).not.toBe(initialState.txns[0].id);
    expect(st.txns[1].desc).toBe(twin.desc); // the row itself is untouched
  });

  it("leaves ids alone in a collection where they are already distinct", () => {
    const st = hydrate(savedBlob());
    ["recurring", "annual", "rules", "txns", "snapshots", "batches", "audit"].forEach((key) => {
      expect(st[key].map((r) => r.id), key).toEqual(initialState[key].map((r) => r.id));
    });
  });

  it("leaves every collection free of duplicate ids", () => {
    const dup = (rows) => [...rows, ...rows.map((r) => ({ ...r }))];
    const st = hydrate(savedBlob({ txns: dup(initialState.txns), audit: dup(initialState.audit), rules: dup(initialState.rules) }));
    ["txns", "audit", "rules"].forEach((key) => {
      const ids = st[key].map((r) => r.id);
      expect(new Set(ids).size, key).toBe(ids.length);
    });
  });

  it("moves the transactions across when a batch id is reminted, so the reference still names a batch", () => {
    const b = savedBlob({ batches: [initialState.batches[0], { ...initialState.batches[0], filename: "second import" }] });
    const st = hydrate(b);
    const batchIds = st.batches.map((x) => x.id);
    expect(new Set(batchIds).size).toBe(2);
    st.txns.filter((t) => t.batchId).forEach((t) => {
      expect(batchIds).toContain(t.batchId);
    });
    expect(st.txns[0].batchId).toBe(batchIds[1]); // they follow the reminted row
  });

  it("does not touch an account or category id, which the rest of the model points at", () => {
    const b = savedBlob({
      accounts: [...initialState.accounts, { ...initialState.accounts[0] }],
      categories: [...initialState.categories, { ...initialState.categories[0] }],
    });
    const st = hydrate(b);
    expect(st.accounts.map((a) => a.id)).toEqual(b.accounts.map((a) => a.id));
    expect(st.categories.map((c) => c.id)).toEqual(b.categories.map((c) => c.id));
    st.txns.forEach((t) => {
      expect(st.accounts.some((a) => a.id === t.accountId), t.id).toBe(true);
      expect(st.categories.some((c) => c.id === t.categoryId), t.id).toBe(true);
    });
  });

  it("does not touch the blob it was handed", () => {
    const b = drop("scenario");
    b.txns = [initialState.txns[0], { ...initialState.txns[0] }];
    b.accounts = null;
    delete b.settings.theme;
    const before = structuredClone(b);
    const st = hydrate(b);
    expect(b).toEqual(before);
    expect(st).not.toBe(b);
  });

  /* The lockout this was written for: one absent key and the first render
     throws, behind an ErrorBoundary whose only offer is to load the same blob
     again. Settings, and with it Reset, is on the far side of App rendering. */
  it("hands the engines a model they can run, where the raw blob would have thrown", () => {
    const b = drop("scenario");
    delete b.mortgage;
    expect(() => buildForecast(b, null)).toThrow();
    const st = hydrate(b);
    expect(() => buildForecast(st, null)).not.toThrow();
    expect(() => buildLongTerm(st, null)).not.toThrow();
    expect(st.accounts.forEach((a) => accountBalance(a, st.txns, st.snapshots))).toBeUndefined();
    expect(st.settings.currency).toBe(initialState.settings.currency);
    expect(st.scenario.enabled).toBe(false);
  });

  /* The original bug, end to end: two rows sharing an id, and the delete every
     table in the app performs. It used to take both. */
  it("leaves a delete by id taking exactly one row out of a pair that shared one", () => {
    const st = hydrate(savedBlob({ recurring: [initialState.recurring[0], { ...initialState.recurring[0] }] }));
    const doomed = st.recurring[1];
    const after = st.recurring.filter((x) => x.id !== doomed.id);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(st.recurring[0].id);
  });
});

/* ============================================================
   A LEGACY SAVED MODEL — through App's own boot path
   ============================================================

   hydrate is only ever called from one place, the useState that seeds App,
   and until now nothing had put a saved model through it. A browser cannot:
   demo mode renders <App /> with no boot at all, and the branch that passes
   one is behind a Supabase session, so with no env vars there is no way to
   reach hydrate from the page. react-dom/server is the nearest thing there
   is — it runs the same `useState(() => boot ? hydrate(boot) : initialState)`
   and the same first render of the whole Overview page, which is exactly
   where the lockout used to happen. Effects do not run, so this proves the
   render and not what follows it. */
describe("a saved model an older client wrote", () => {
  freezeNow();

  const renderApp = (boot) => renderToString(React.createElement(App, { boot }));

  const TWIN_REC = "Gardening, entered a second time";
  const TWIN_TXN = "BOND REPAYMENT HOMELOAN (duplicate)";

  /* Everything an old blob is actually wrong about, in one model: no schema
     stamp, a whole top-level key it predates, a sub-key of mortgage it
     predates, a sub-key of settings it predates, a key a later client added
     that this one has never heard of, and two pairs of rows each carrying one
     id because the counter handed the same number out twice. */
  const legacyModel = () => {
    const b = structuredClone(initialState);
    delete b.schemaVersion;
    delete b.scenario;
    delete b.mortgage.propertyValueC;
    delete b.settings.theme;
    b.settings.currency = "£";
    b.recurring = [...b.recurring, { ...b.recurring[2], name: TWIN_REC }];
    b.txns = [...b.txns, { ...b.txns[0], desc: TWIN_TXN }];
    b.nickname = "Alex";
    return b;
  };

  it("draws the whole page from that blob, carrying the figures it saved", () => {
    const html = renderApp(legacyModel());
    expect(html).toContain("Overview");
    expect(html).toContain("Net worth");
    expect(html).toContain("£"); // the saved currency, not the seeded one
    expect(html.length).toBeGreaterThan(10000);
  });

  /* The lockout, key by key. Every one of these is read before the first
     paint, and eleven of the fourteen throw on the way in without hydrate —
     behind an ErrorBoundary offering only to load the same blob again. */
  it("draws the page whichever single top-level key the blob has not got", () => {
    Object.keys(initialState).forEach((key) => {
      const b = structuredClone(initialState);
      delete b[key];
      expect(() => renderApp(b), `missing ${key}`).not.toThrow();
    });
  });

  it("draws the page where a top-level key came back null rather than absent", () => {
    Object.keys(initialState).forEach((key) => {
      const b = structuredClone(initialState);
      b[key] = null;
      expect(() => renderApp(b), `null ${key}`).not.toThrow();
    });
  });

  it("draws the page from a blob that is not a saved model at all", () => {
    [{}, [], "nonsense", 42, null].forEach((b) => {
      expect(() => renderApp(b), String(b)).not.toThrow();
    });
  });

  /* The original bug, in every table the counter could have collided in.
     Deleting one row is filter((x) => x.id !== id) everywhere in the app, so
     the damage is measured the way the app does it: ask for one row and count
     what is left. On the blob as saved, asking for one loses two. */
  it("leaves a delete by id taking exactly one row, in every table that mints ids", () => {
    ["recurring", "annual", "rules", "txns", "snapshots", "batches", "audit"].forEach((key) => {
      const rows = initialState[key];
      const twin = { ...rows[0], twinMarker: true };
      const b = { ...structuredClone(initialState), [key]: [...structuredClone(rows), twin] };

      // as saved: one delete takes the twin and the row it collided with
      expect(b[key].filter((x) => x.id !== twin.id), key).toHaveLength(rows.length - 1);

      const st = hydrate(b);
      const doomed = st[key][st[key].length - 1];
      expect(doomed.twinMarker, key).toBe(true);
      const after = st[key].filter((x) => x.id !== doomed.id);
      expect(after, key).toHaveLength(rows.length);
      expect(after.map((r) => r.id), key).toEqual(rows.map((r) => r.id));

      // and the edit half of it: one row changes, not both
      const edited = st[key].map((x) => (x.id === doomed.id ? { ...x, edited: true } : x));
      expect(edited.filter((x) => x.edited), key).toHaveLength(1);
    });
  });

  /* Forward compatibility is the reason this is a merge and not a rebuild.
     An older tab that loaded a newer tab's model writes the whole thing back,
     so anything it drops is gone — including a key inside one of the four
     settings objects, and including a key on the one row hydrate rewrites. */
  it("brings a newer client's keys back out at every level a merge could have dropped them", () => {
    const b = legacyModel();
    b.goals = [{ id: "g1", name: "New roof" }];
    b.settings.accentColour = "teal";
    b.comp.thirteenthCheque = true;
    b.mortgage.offsetAccountId = "acc_savings";
    b.scenario = { jobLossMonths: 6 };
    b.txns[0].receiptUrl = "https://example.test/r/1";
    b.recurring[b.recurring.length - 1].reminderDays = 3; // on the row that gets reminted

    const st = hydrate(b);
    expect(st.goals).toEqual([{ id: "g1", name: "New roof" }]);
    expect(st.nickname).toBe("Alex");
    expect(st.settings.accentColour).toBe("teal");
    expect(st.comp.thirteenthCheque).toBe(true);
    expect(st.mortgage.offsetAccountId).toBe("acc_savings");
    expect(st.scenario.jobLossMonths).toBe(6);
    expect(st.scenario.enabled).toBe(false); // and the known keys still filled
    expect(st.txns[0].receiptUrl).toBe("https://example.test/r/1");

    const reminted = st.recurring[st.recurring.length - 1];
    expect(reminted.name).toBe(TWIN_REC);
    expect(reminted.id).not.toBe(initialState.recurring[2].id);
    expect(reminted.reminderDays).toBe(3);
  });

  /* Accounts and categories are what everything else names. Reminting one
     would cut every row that points at it adrift, so they are left alone even
     where they collide — and after all the reminting above, every reference in
     the model still has to land on a row that exists. */
  it("leaves account and category ids alone, with nothing left pointing at a row that is not there", () => {
    const b = legacyModel();
    b.batches = [...b.batches, { ...b.batches[0], filename: "second import" }];
    b.snapshots = [...b.snapshots, { ...b.snapshots[0] }];
    b.rules = [...b.rules, { ...b.rules[0] }];
    b.annual = [...b.annual, { ...b.annual[0] }];
    b.accounts = [...b.accounts, { ...b.accounts[0] }];       // even a collision here
    b.categories = [...b.categories, { ...b.categories[0] }];
    const accountIdsAsSaved = b.accounts.map((a) => a.id);
    const categoryIdsAsSaved = b.categories.map((c) => c.id);

    const st = hydrate(b);
    expect(st.accounts.map((a) => a.id)).toEqual(accountIdsAsSaved);
    expect(st.categories.map((c) => c.id)).toEqual(categoryIdsAsSaved);

    const accIds = new Set(st.accounts.map((a) => a.id));
    const catIds = new Set(st.categories.map((c) => c.id));
    const batchIds = new Set(st.batches.map((x) => x.id));
    st.txns.forEach((t) => {
      expect(accIds.has(t.accountId), `txn ${t.desc} account`).toBe(true);
      expect(catIds.has(t.categoryId), `txn ${t.desc} category`).toBe(true);
      if (t.batchId) expect(batchIds.has(t.batchId), `txn ${t.desc} batch`).toBe(true);
    });
    st.snapshots.forEach((s) => expect(accIds.has(s.accountId), `snapshot ${s.id}`).toBe(true));
    [...st.recurring, ...st.annual, ...st.rules].forEach((r) =>
      expect(catIds.has(r.categoryId), `${r.name || r.pattern} category`).toBe(true));
    st.batches.forEach((x) => x.accountIds.forEach((id) =>
      expect(accIds.has(id), `batch ${x.filename} account`).toBe(true)));
    expect(new Set(st.batches.map((x) => x.id)).size).toBe(st.batches.length);
  });

  /* Safari before 15.4 has no randomUUID, and neither has any browser served
     over plain http, so the fallback is not a corner case. Count the calls:
     an id that is merely well-formed proves nothing about which branch ran. */
  it("mints ids through the fallback where randomUUID is missing, and repairs a model with it", () => {
    const UUID_ID = /^[a-z]+_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
    const real = globalThis.crypto;
    let calls = 0;
    vi.stubGlobal("crypto", { getRandomValues: (a) => { calls += 1; return real.getRandomValues(a); } });
    try {
      expect(globalThis.crypto.randomUUID).toBeUndefined();

      const ids = new Set();
      for (let i = 0; i < 5000; i++) ids.add(uid("txn"));
      expect(calls).toBe(5000); // every one of them came out of getRandomValues
      expect(ids.size).toBe(5000);
      ids.forEach((id) => expect(id).toMatch(UUID_ID));

      // and the repair itself works on that branch, which is what matters
      const b = legacyModel();
      const st = hydrate(b);
      const reminted = st.recurring[st.recurring.length - 1];
      expect(reminted.id).toMatch(UUID_ID);
      expect(new Set(st.recurring.map((r) => r.id)).size).toBe(st.recurring.length);
      expect(new Set(st.txns.map((t) => t.id)).size).toBe(st.txns.length);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

/* ============================================================
   A ROW WHOSE FIELDS ARE THE WRONG TYPE
   ============================================================

   hydrate put the right kind of thing at every top-level key and said nothing
   about what was inside a row, which is where the next lockout came from: a
   saved model carrying date: 20260115 — the same date, as a number rather than
   a string — walked through all of it and then reached
   txns.filter((t) => t.date.slice(0, 7) === ym), which runs before anything is
   drawn, on every page.

   The wrong type in a money field does not throw, which is worse: it turns
   every total that row is added to into a concatenated string. Both are here,
   each measured through the function that actually reads the field. */
describe("hydrate, on a row whose fields are the wrong type", () => {
  freezeNow();

  const savedBlob = (damage = {}) => ({ ...structuredClone(initialState), ...damage });
  const renderApp = (boot) => renderToString(React.createElement(App, { boot }));
  const txn = (over = {}) => ({ ...structuredClone(initialState.txns[0]), ...over });
  const bankAcc = () => structuredClone(initialState.accounts.find((a) => a.id === "acc_bank"));
  const investAcc = () => structuredClone(initialState.accounts.find((a) => a.id === "acc_invest"));
  const repairLine = (st) => st.audit.find((a) => a.kind === "repair");

  /* The crash, reproduced: this is the blob the ErrorBoundary work was proved
     against, and buildForecast is the first thing every page runs. */
  it("takes the numeric date the user was locked out by", () => {
    const b = savedBlob({ txns: [txn({ date: 20260115 })] });
    expect(() => buildForecast(b, null)).toThrow(/\.date\.slice is not a function/);

    const st = hydrate(b);
    expect(st.txns[0].date).toBe("2026-01-15");
    expect(() => buildForecast(st, null)).not.toThrow();
    expect(() => renderApp(b)).not.toThrow();
  });

  it("puts that date back where the month views look for it", () => {
    const st = hydrate(savedBlob({ txns: [txn({ date: 20260115 })] }));
    expect(st.txns.filter((t) => t.date.slice(0, 7) === "2026-01")).toHaveLength(1);
  });

  it("trims a full timestamp back to the day, which is what the app compares", () => {
    const b = savedBlob({ txns: [txn({ date: "2026-01-15T09:12:00.000Z", amountC: -100000 })], snapshots: [] });
    const acc = bankAcc();
    // as saved, the timestamp sorts after the day it happened on, so a balance
    // asked for on that date leaves the transaction out
    expect(accountBalance(acc, b.txns, b.snapshots, "2026-01-15")).toBe(acc.openingC);

    const st = hydrate(b);
    expect(st.txns[0].date).toBe("2026-01-15");
    expect(accountBalance(acc, st.txns, st.snapshots, "2026-01-15")).toBe(acc.openingC - 100000);
  });

  it("takes a numeric date on a balance snapshot too, which is sorted rather than sliced", () => {
    const b = savedBlob({
      txns: [],
      snapshots: [
        { id: "snap_a", accountId: "acc_invest", date: 20260115, balanceC: 6520000 },
        { id: "snap_b", accountId: "acc_invest", date: 20260215, balanceC: 6790000 },
      ],
    });
    const acc = investAcc();
    expect(() => accountBalance(acc, b.txns, b.snapshots)).toThrow(/localeCompare is not a function/);

    const st = hydrate(b);
    expect(st.snapshots.map((s) => s.date)).toEqual(["2026-01-15", "2026-02-15"]);
    expect(accountBalance(acc, st.txns, st.snapshots)).toBe(6790000);
  });

  it("does not read just any eight-digit number as a date", () => {
    const st = hydrate(savedBlob({ txns: [txn({ date: 20261332 }), txn({ date: 45678901, desc: "SHELL ULTRA CITY" })] }));
    expect(st.txns).toHaveLength(0);
  });

  it("will not read 01/02/2026, because that is two different days", () => {
    const st = hydrate(savedBlob({ txns: [txn({ desc: "CHECKERS HYPER", date: "01/02/2026" })] }));
    expect(st.txns).toHaveLength(0);
    expect(repairLine(st).detail).toContain('date was "01/02/2026"');
  });

  /* Money is integer cents throughout, so "-1850000" is the same figure with
     quotes round it. Nothing throws on it — it silently concatenates. */
  it("reads an amount saved as a string of digits back as the cents it is", () => {
    const b = savedBlob({ txns: [txn({ amountC: "-1850000" })], snapshots: [] });
    const acc = bankAcc();
    expect(accountBalance(acc, b.txns, b.snapshots)).toBe("42500000-1850000");

    const st = hydrate(b);
    expect(st.txns[0].amountC).toBe(-1850000);
    expect(accountBalance(acc, st.txns, st.snapshots)).toBe(2400000);
  });

  /* Money in, specifically: the forecast multiplies a negative recurring
     amount by the spend scenario on the way past and a string quietly becomes
     a number there, so it is an income row that carries the fault through to
     the total the screen is drawn from. */
  it("reads a recurring amount saved as a string, which the forecast adds up", () => {
    const rent = { id: "rec_rent", name: "Rent received", categoryId: "cat_general", amountC: "1200000", day: 1 };
    const b = savedBlob({ recurring: [rent], txns: [] });
    expect(typeof buildForecast(b, null).rows[0].net).toBe("string");

    const st = hydrate(b);
    expect(st.recurring[0].amountC).toBe(1200000);
    const clean = buildForecast({ ...b, recurring: [{ ...rent, amountC: 1200000 }] }, null);
    expect(buildForecast(st, null).rows[0].net).toBe(clean.rows[0].net);
    expect(typeof buildForecast(st, null).rows[0].net).toBe("number");
  });

  it("reads a snapshot balance saved as a string", () => {
    const b = savedBlob({ txns: [], snapshots: [{ id: "snap_a", accountId: "acc_invest", date: "2026-01-15", balanceC: "65200000" }] });
    const acc = investAcc();
    expect(typeof accountBalance(acc, b.txns, b.snapshots)).toBe("string");

    const st = hydrate(b);
    expect(st.snapshots[0].balanceC).toBe(65200000);
    expect(accountBalance(acc, st.txns, st.snapshots)).toBe(65200000);
  });

  /* 12.34 is twelve cents or it is R12,34, which is 1234 cents. Nothing in the
     model says which, and they differ by a factor of a hundred. */
  it("will not guess whether 12.34 is twelve cents or twelve rand", () => {
    const st = hydrate(savedBlob({ txns: [txn({ desc: "WOOLWORTHS CLAREMONT", amountC: 12.34 })] }));
    expect(st.txns).toHaveLength(0);
    expect(repairLine(st).detail).toContain("WOOLWORTHS CLAREMONT");
    expect(repairLine(st).detail).toContain("12.34");
    expect(st.audit[0]).toBe(repairLine(st)); // newest first, like every other audit line
  });

  it("names the row and quotes the value, so what it left out is on the screen", () => {
    const b = savedBlob({
      txns: [txn({ desc: "SHELL ULTRA CITY", amountC: "R1 234,56" })],
      snapshots: [{ id: "snap_a", accountId: "acc_invest", date: null, balanceC: 100 }],
    });
    const line = repairLine(hydrate(b));
    expect(line.kind).toBe("repair");
    expect(line.id).toMatch(/^aud_/);
    expect(line.when).toBe("2026-03-15 12:00");
    expect(line.detail).toContain("transaction “SHELL ULTRA CITY”");
    expect(line.detail).toContain('amountC was "R1 234,56"');
    expect(line.detail).toContain("balance snapshot");
    expect(line.detail).toContain("date was null");
  });

  it("drops what is not a row at all, keeps what is, and draws the page anyway", () => {
    const b = savedBlob({ txns: [null, txn(), undefined, "nonsense", 42, []] });
    expect(() => buildForecast(b, null)).toThrow();

    const st = hydrate(b);
    expect(st.txns).toHaveLength(1);
    expect(st.txns[0].desc).toBe(initialState.txns[0].desc);
    expect(repairLine(st).detail).toContain("5 rows");
    expect(() => renderApp(b)).not.toThrow();
  });

  it("mints an id for a row that has not got one, so a delete can name it", () => {
    const b = savedBlob({ txns: [txn({ desc: "NO ID HERE" }), txn()] });
    delete b.txns[0].id;

    const st = hydrate(b);
    expect(st.txns[0].id).toMatch(/^txn_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(st.txns[0].desc).toBe("NO ID HERE");
    expect(st.txns[1].id).toBe(initialState.txns[0].id);
    expect(st.txns.filter((t) => t.id !== st.txns[0].id)).toHaveLength(1);
  });

  it("gives two id-less rows an id each, so deleting one does not take the other", () => {
    const b = savedBlob({ txns: [txn(), txn({ desc: "THE OTHER ONE" })] });
    delete b.txns[0].id;
    delete b.txns[1].id;
    // as saved, one delete by id takes both, which is the twin-delete bug again
    expect(b.txns.filter((t) => t.id !== b.txns[0].id)).toHaveLength(0);

    const st = hydrate(b);
    expect(st.txns).toHaveLength(2);
    st.txns.forEach((t) => expect(t.id).toMatch(/^txn_[0-9a-f-]{36}$/));
    expect(st.txns[0].id).not.toBe(st.txns[1].id);
    expect(st.txns.filter((t) => t.id !== st.txns[0].id)).toHaveLength(1);
  });

  it("keeps a transaction pointing at its import when the batch id was not a string", () => {
    const b = savedBlob({
      batches: [{ id: 7, filename: "january.csv", when: "2026-01-31 08:00", count: 1, accountIds: ["acc_bank"] }],
      txns: [txn({ batchId: 7 })],
    });
    const st = hydrate(b);
    expect(typeof st.batches[0].id).toBe("string");
    expect(st.txns[0].batchId).toBe(st.batches[0].id);
  });

  it("changes nothing in a model whose rows are all the right type", () => {
    const b = savedBlob();
    const st = hydrate(b);
    ["categories", "accounts", "recurring", "annual", "rules", "txns", "snapshots", "batches", "audit"].forEach((key) => {
      expect(st[key], key).toEqual(b[key]);
    });
  });

  it("writes nothing to the audit trail when there was nothing to leave out", () => {
    expect(hydrate(savedBlob()).audit).toEqual(initialState.audit);
  });

  it("does not touch the blob it was handed while repairing it", () => {
    const b = savedBlob({ txns: [txn({ date: 20260115 }), txn({ desc: "BAD", amountC: 12.34 }), null] });
    b.snapshots = [{ id: "snap_a", accountId: "acc_invest", date: 20260115, balanceC: "6520000" }];
    const before = structuredClone(b);
    hydrate(b);
    expect(b).toEqual(before);
  });
});

/* ============================================================
   A REFERENCE THAT NAMES A ROW WHICH IS NO LONGER THERE
   ============================================================

   Four references hold the model together — txns.accountId, txns.categoryId,
   the categoryId on recurring items, annual items and import rules, and
   snapshots.accountId — and nothing has ever checked that the row on the other
   end of one is still there.

   Nothing could delete that row, which is the only reason this has been
   survivable, and that is about to stop being true. What a dangling reference
   does today, each measured below through the function that actually reads it:
   isFlow reads an unknown category as a flow, so a transfer quietly becomes
   spending; accountBalance filters by accountId, so a transaction naming an
   account that is gone is in no balance and in no net worth while still
   counting in the month; and catName degrades to "—" against a <select> built
   only from live categories, so the dead id sits in state where nobody can see
   it. */
describe("hydrate, on a reference that names a category or account which is not there", () => {
  freezeNow();

  const YM = "2026-03"; // the frozen month, which is what buildForecast opens on
  const emptyBlob = (damage = {}) => ({ ...structuredClone(blankState), ...damage });
  const cats = (...dropped) => structuredClone(blankState.categories).filter((c) => !dropped.includes(c.id));
  const txn = (over = {}) => ({ id: uid("txn"), accountId: "acc_bank", date: `${YM}-15`, desc: "WOOLWORTHS CLAREMONT", amountC: -110000, categoryId: "cat_food", source: "import", ...over });
  const repairLine = (st) => st.audit.find((a) => a.kind === "repair");
  const renderApp = (boot) => renderToString(React.createElement(App, { boot }));
  const monthSpend = (st) => st.txns.filter((t) => t.date.slice(0, 7) === YM && isFlow(t, st.categories) && t.amountC < 0).reduce((s, t) => s + t.amountC, 0);
  const netWorth = (st) => st.accounts.reduce((s, a) => s + accountBalance(a, st.txns, st.snapshots), 0);
  const net = (st) => buildForecast(st, null).rows[0].net;

  /* The sharpest of the four, because the arithmetic changes and nothing says
     so: isFlow's `!c ||` reads a category that is not there as a flow, so a
     transfer between the user's own accounts starts counting as money spent. */
  it("counts a transfer whose category is gone as spending, and moves it where that can be seen", () => {
    const b = emptyBlob({
      categories: cats("cat_invest"),
      txns: [txn({ desc: "TRANSFER TO INVESTMENT", amountC: -500000, categoryId: "cat_invest" })],
    });
    expect(isFlow(b.txns[0], b.categories)).toBe(true);
    expect(monthSpend(b)).toBe(-500000); // R5 000 of spending that never left the user's money

    const st = hydrate(b);
    expect(st.txns[0].categoryId).toBe("cat_uncat");
    expect(st.txns[0].amountC).toBe(-500000);
    /* The figure itself does not come back, and this is the honest limit of
       the pass: kind: "transfer" lived on the category row that was deleted,
       so there is nothing left in the model that knows this was a transfer.
       Uncategorised is an expense, exactly as an absent category already was.
       What changes is that the row now names something the user can see and
       re-point, instead of a dead id behind a blank dropdown. */
    expect(monthSpend(st)).toBe(-500000);
  });

  it("shows the reassigned transaction on the page instead of an em dash", () => {
    const b = emptyBlob({ categories: cats("cat_food"), txns: [txn()] });
    const html = renderApp(b);
    expect(html).toContain("Uncategorised");
    expect(html).not.toContain("<td>—</td>");
  });

  /* A repair that moved only the transactions would be worse than none: the
     recurring item left on the dead id matches nothing, so the forecast pays
     its planned amount *and* sweeps the same transactions in again as
     unplanned spending. Both ends of the reference move together. */
  it("moves a recurring item and the transactions it matches together, so the month is not counted twice", () => {
    const food = { id: "rec_food", name: "Food", categoryId: "cat_food", amountC: -1100000, day: 15 };
    const spend = txn({ amountC: -1100000, categoryId: "cat_food" });
    const intact = emptyBlob({ recurring: [food], txns: [spend] });
    const damaged = { ...intact, categories: cats("cat_food") };
    const txnsOnly = { ...damaged, txns: [{ ...spend, categoryId: "cat_uncat" }] };
    expect(net(txnsOnly)).toBe(-2200000);
    expect(net(intact)).toBe(-1100000);

    const st = hydrate(damaged);
    expect(st.recurring[0].categoryId).toBe("cat_uncat");
    expect(st.txns[0].categoryId).toBe("cat_uncat");
    expect(net(st)).toBe(net(intact));
  });

  it("moves an annual item off a category that is gone", () => {
    const b = emptyBlob({ categories: cats("cat_carins"), annual: [{ id: "ann_car", name: "Car Insurance", categoryId: "cat_carins", month: 3, amountC: -1450000, escalationPct: 6 }] });
    const st = hydrate(b);
    expect(st.annual[0].categoryId).toBe("cat_uncat");
    expect(st.annual[0].amountC).toBe(-1450000);
  });

  /* applyRules returns rule.categoryId with no check that it names anything,
     so one dead rule stamps the dead id onto every row of every import from
     then on. This is the reference that spreads. */
  it("takes the dead category off an import rule, which would otherwise stamp it on every imported row", () => {
    const b = emptyBlob({ categories: cats("cat_fuel"), rules: [{ id: "rule_shell", pattern: "SHELL", categoryId: "cat_fuel" }] });
    const st = hydrate(b);
    expect(st.rules[0].categoryId).toBe("cat_uncat");
    expect(st.rules[0].pattern).toBe("SHELL"); // the user's rule is kept, only its target moves
  });

  it("takes a transaction that carries no categoryId at all to the same place", () => {
    const b = emptyBlob({ txns: [txn({ categoryId: undefined })] });
    const st = hydrate(b);
    expect(st.txns[0].categoryId).toBe("cat_uncat");
  });

  /* Everything above lands on cat_uncat, so cat_uncat has to be there. It is
     in blankState today and it is hardcoded in AddTxn and in applyRules, but
     nothing enforces it, and a model without it turns every one of those into
     a fresh dangling reference. */
  it("puts cat_uncat back when the saved model has not got one", () => {
    const b = emptyBlob({ categories: cats("cat_uncat", "cat_food"), txns: [txn()] });
    const st = hydrate(b);
    expect(st.categories.filter((c) => c.id === "cat_uncat")).toHaveLength(1);
    expect(st.categories.find((c) => c.id === "cat_uncat")).toEqual(initialState.categories.find((c) => c.id === "cat_uncat"));
    expect(st.txns[0].categoryId).toBe("cat_uncat");
    expect(renderApp(b)).toContain("Uncategorised");
  });

  it("leaves the category list alone when cat_uncat is already in it", () => {
    const st = hydrate(emptyBlob({ txns: [txn({ categoryId: "cat_gone" })] }));
    expect(st.categories.map((c) => c.id)).toEqual(blankState.categories.map((c) => c.id));
  });

  /* The account half is deliberately not repaired. There is no uncategorised
     account to move a transaction to, and every candidate — the first account,
     a new one invented here — is a statement about where the user's money
     actually sits. The disagreement it leaves behind is measured here so that
     it is on the record rather than in a comment. */
  it("leaves a transaction naming an account that is gone exactly where it is, and says so", () => {
    const b = emptyBlob({ txns: [txn({ accountId: "acc_gone", amountC: -250000, desc: "ORPHANED DEBIT" })] });
    const st = hydrate(b);
    expect(st.txns[0].accountId).toBe("acc_gone");
    expect(st.txns[0].amountC).toBe(-250000);
    expect(netWorth(st)).toBe(0); // in no account balance
    expect(monthSpend(st)).toBe(-250000); // and in the month's spending all the same
    expect(repairLine(st).detail).toContain("1 transaction");
    expect(repairLine(st).detail).toContain("account that is not in this model");
  });

  it("leaves a balance snapshot naming an account that is gone, and counts it in the same line", () => {
    const b = emptyBlob({ snapshots: [{ id: "snap_x", accountId: "acc_gone", date: `${YM}-01`, balanceC: 99900000 }] });
    const st = hydrate(b);
    expect(st.snapshots[0].accountId).toBe("acc_gone");
    expect(st.snapshots[0].balanceC).toBe(99900000);
    expect(repairLine(st).detail).toContain("1 balance snapshot");
  });

  it("names what it moved and what it could not, in one line, in the trail the app already keeps", () => {
    const b = emptyBlob({
      categories: cats("cat_food", "cat_fuel"),
      txns: [txn(), txn({ desc: "SHELL ULTRA CITY", categoryId: "cat_fuel" }), txn({ desc: "ORPHANED DEBIT", accountId: "acc_gone", categoryId: "cat_general" })],
      rules: [{ id: "rule_shell", pattern: "SHELL", categoryId: "cat_fuel" }],
    });
    const line = repairLine(hydrate(b));
    expect(line.kind).toBe("repair");
    expect(line.id).toMatch(/^aud_/);
    expect(line.when).toBe("2026-03-15 12:00");
    expect(line.detail).toContain("Moved 2 transactions and 1 import rule to Uncategorised");
    expect(line.detail).toContain("1 transaction names an account that is not in this model");
  });

  /* An unrepairable finding is re-found on every single load — the freshly
     hydrated state is deliberately not saved — so a line that was written
     unconditionally would grow the audit trail by one row per page load for
     as long as the orphan sits there. */
  it("does not write the same line again on the next load", () => {
    const b = emptyBlob({ txns: [txn({ accountId: "acc_gone" })] });
    const once = hydrate(b);
    expect(once.audit.filter((a) => a.kind === "repair")).toHaveLength(1);
    const twice = hydrate(once);
    expect(twice.audit.filter((a) => a.kind === "repair")).toHaveLength(1);
    expect(twice.audit).toEqual(once.audit);
  });

  it("says nothing, and moves nothing, in a model whose references are all live", () => {
    const b = structuredClone(initialState);
    const st = hydrate(b);
    expect(st.audit).toEqual(initialState.audit);
    ["categories", "accounts", "recurring", "annual", "rules", "txns", "snapshots"].forEach((key) => {
      expect(st[key], key).toEqual(b[key]);
    });
  });

  /* The seeded and the empty model are what a new user and a reset user get,
     and either one arriving with a dangling reference would be this pass
     firing on the app's own data. */
  it("finds nothing dangling in the models the app ships with", () => {
    [initialState, blankState].forEach((model) => {
      const catIds = new Set(model.categories.map((c) => c.id));
      const accIds = new Set(model.accounts.map((a) => a.id));
      [...model.txns, ...model.recurring, ...model.annual, ...model.rules].forEach((r) => expect(catIds.has(r.categoryId), r.id).toBe(true));
      [...model.txns, ...model.snapshots].forEach((r) => expect(accIds.has(r.accountId), r.id).toBe(true));
    });
  });

  it("draws a model whose references are all dangling rather than throwing", () => {
    const b = emptyBlob({
      categories: [],
      accounts: [],
      txns: [txn({ accountId: "acc_gone", categoryId: "cat_gone" })],
      recurring: [{ id: "rec_a", name: "Food", categoryId: "cat_gone", amountC: -1100000, day: 15 }],
      snapshots: [{ id: "snap_x", accountId: "acc_gone", date: `${YM}-01`, balanceC: 100 }],
    });
    expect(() => renderApp(b)).not.toThrow();
    const st = hydrate(b);
    expect(st.categories.map((c) => c.id)).toEqual(["cat_uncat"]);
    expect(st.txns[0].categoryId).toBe("cat_uncat");
  });

  it("does not touch the blob it was handed", () => {
    const b = emptyBlob({
      categories: cats("cat_food", "cat_uncat"),
      txns: [txn(), txn({ accountId: "acc_gone" })],
      recurring: [{ id: "rec_food", name: "Food", categoryId: "cat_food", amountC: -1100000, day: 15 }],
      rules: [{ id: "rule_w", pattern: "WOOLWORTHS", categoryId: "cat_food" }],
    });
    const before = structuredClone(b);
    hydrate(b);
    expect(b).toEqual(before);
  });
});
