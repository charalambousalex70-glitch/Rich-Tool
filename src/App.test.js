import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  toC, C, C0, parseDateAny,
  isFlow, accountBalance,
  monthlyPayment, amortise,
  matchRecurring, matchAnnual,
  buildForecast, buildLongTerm, parseOFX,
  isReadableAmount, isReadableNumber, ageError, termMonthsError,
  AGE_MIN, AGE_MAX, TERM_MONTHS_MAX,
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

  it("takes the latest snapshot for investment accounts, ignoring transactions", () => {
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
    expect(rows[0].cashC).toBe(15800000); // 5000000 opening + 10800000
    rows.forEach((r, i) => {
      if (i > 0) expect(r.cashC).toBe(rows[i - 1].cashC + r.netC);
    });
  });

  it("reports no depletion while liquid assets remain positive", () => {
    expect(buildLongTerm(baseState(), null).depletionAge).toBeNull();
  });

  it("records a depletion age once liquid assets run out in retirement", () => {
    const s = baseState();
    s.accounts = [{ id: "a1", type: "bank", openingC: 100000 }];
    s.settings = { ...s.settings, retirementAge: 60 };
    const { rows, depletionAge } = buildLongTerm(s, null);
    expect(depletionAge).toBe(60);
    expect(rows[0].liquidC).toBeLessThanOrEqual(0);
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
