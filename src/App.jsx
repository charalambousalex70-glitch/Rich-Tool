import React, { useState, useMemo, useRef, useEffect } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend, Cell,
} from "recharts";
import { THEME_CSS, CHART, readStoredTheme, storeTheme, applyTheme } from "./theme.js";

/* ============================================================
   MONEY — integer cents everywhere. No floats touch stored data.
   ============================================================ */
export const toC = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const raw = String(v).trim();
  // accounting exports write a negative as "(45.00)" or "R(45.00)" — read the
  // parentheses off the raw value, before the strip below removes them.
  // Parens force the sign negative, they do not flip it, so "(-45.00)" stays -45.00.
  const paren = /^[^\d]*\([^)]*\d[^)]*\)[^\d]*$/.test(raw);
  const s = raw.replace(/[^\d.\-,]/g, "");
  // handle "1,234.56" and "1.234,56"
  let n;
  if (/,\d{1,2}$/.test(s)) n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  // dot-grouped thousands, e.g. "1.234" and "12.345.678": a non-zero leading
  // group of 1-3 digits followed by groups of exactly three digits.
  else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(s)) n = parseFloat(s.replace(/\./g, ""));
  else n = parseFloat(s.replace(/,/g, ""));
  if (isNaN(n)) return 0;
  const cents = Math.round(n * 100);
  return paren ? -Math.abs(cents) : cents;
};
export const C = (cents, cur = "R") => {
  const neg = cents < 0;
  const a = Math.abs(cents);
  const whole = Math.floor(a / 100).toLocaleString("en-US");
  const dec = String(a % 100).padStart(2, "0");
  return `${neg ? "\u2212" : ""}${cur}${whole}.${dec}`;
};
export const C0 = (cents, cur = "R") => {
  const neg = cents < 0;
  return `${neg ? "\u2212" : ""}${cur}${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
};

/* ============================================================
   INPUT VALIDATION \u2014 toC and parseFloat both fall back to 0, so
   typing "abc" books R0.00 without saying anything. These decide
   whether a field is readable *before* it is committed; toC itself
   is untouched, because the import pipeline depends on its
   forgiveness.
   ============================================================ */

/** True when toC will read a real figure out of `v` (and not fall back to 0). */
export const isReadableAmount = (v) => {
  if (v === null || v === undefined) return false;
  const raw = String(v).trim();
  if (raw === "") return false;
  const s = raw.replace(/[^\d.\-,]/g, ""); // the same strip toC performs
  return /\d/.test(s) && !isNaN(parseFloat(s.replace(/,/g, "")));
};

/** True when `v` is a plain number \u2014 used for the percentage/age fields. */
export const isReadableNumber = (v) => {
  if (v === null || v === undefined) return false;
  const raw = String(v).trim();
  if (raw === "") return false;
  return Number.isFinite(Number(raw));
};

/* Ages are bounded 18-120: below 18 there is no working life to model, above
   120 the projection is fiction and the annual table grows without purpose. */
export const AGE_MIN = 18;
export const AGE_MAX = 120;
/** 50 years \u2014 longer than any mortgage term a lender writes. */
export const TERM_MONTHS_MAX = 600;

/**
 * Validates one age edit against the other two. Returns a plain-language
 * reason to reject, or null to accept.
 *
 * planningAge must sit above currentAge, otherwise buildLongTerm projects zero
 * years and the Long-Term Plan has nothing to show.
 *
 * retirementAge is deliberately NOT checked against currentAge: a retirement
 * age below the current age is simply someone who has already retired, and
 * buildLongTerm handles it correctly (every projected year counts as retired).
 */
export const ageError = (field, value, settings) => {
  if (!Number.isFinite(value)) return "Enter a whole number.";
  const n = Math.round(value);
  if (n < AGE_MIN || n > AGE_MAX) return `Enter an age between ${AGE_MIN} and ${AGE_MAX}.`;
  if (field === "planningAge" && n <= settings.currentAge)
    return `The plan needs somewhere to run to. Enter a planning age above your current age of ${settings.currentAge}.`;
  if (field === "currentAge" && n >= settings.planningAge)
    return `Your current age has to be below your planning age of ${settings.planningAge}. Raise the planning age first.`;
  return null;
};

/** Validates a mortgage term in months. Returns a reason to reject, or null. */
export const termMonthsError = (value) => {
  if (!Number.isFinite(value)) return "Enter a whole number of months.";
  const n = Math.round(value);
  if (n < 1 || n > TERM_MONTHS_MAX)
    return `Enter a term between 1 and ${TERM_MONTHS_MAX} months (50 years).`;
  return null;
};

/* ---- dates ---- */
const todayISO = () => new Date().toISOString().slice(0, 10);
const nowYm = () => todayISO().slice(0, 7);
const ymAdd = (ym, k) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + k, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const ymLabel = (ym) => `${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;
const ymShort = (ym) => `${MONTHS[+ym.slice(5) - 1]} ’${ym.slice(2, 4)}`;

export const parseDateAny = (raw, dayFirst = true) => {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") {
    // Excel serial
    const d = new Date(Math.round((raw - 25569) * 86400 * 1000));
    return isNaN(d) ? null : d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) {
    let [_, a, b, y] = m;
    if (y.length === 2) y = "20" + y;
    let dd = dayFirst ? a : b, mm = dayFirst ? b : a;
    if (+mm > 12 && +dd <= 12) { const t = mm; mm = dd; dd = t; }
    return `${y}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  m = s.match(/^(\d{8})$/); // OFX 20260715
  if (m) return `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`;
  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString().slice(0, 10);
};

let _id = 1000;
const uid = (p) => `${p}_${++_id}`;

/* ============================================================
   SEED DATA — mirrors the seven tables of the spreadsheet model
   ============================================================ */
const CUR_YM = nowYm();
const seedCategories = [
  { id: "cat_salary",   name: "Salary",            kind: "income" },
  { id: "cat_bonus",    name: "Bonus",             kind: "income" },
  { id: "cat_cleaning", name: "Cleaning",          kind: "expense" },
  { id: "cat_garden",   name: "Gardening",         kind: "expense" },
  { id: "cat_gas",      name: "Gas",               kind: "expense" },
  { id: "cat_elec",     name: "Electricity",       kind: "expense" },
  { id: "cat_medical",  name: "Medical",           kind: "expense" },
  { id: "cat_food",     name: "Food & Groceries",  kind: "expense" },
  { id: "cat_mortgage", name: "Mortgage",          kind: "expense" },
  { id: "cat_ccpay",    name: "Credit Card Payment", kind: "transfer" },
  { id: "cat_water",    name: "Water",             kind: "expense" },
  { id: "cat_netflix",  name: "Netflix",           kind: "expense" },
  { id: "cat_ps",       name: "PlayStation",       kind: "expense" },
  { id: "cat_fuel",     name: "Fuel",              kind: "expense" },
  { id: "cat_haircut",  name: "Haircut",           kind: "expense" },
  { id: "cat_general",  name: "General Expenses",  kind: "expense" },
  { id: "cat_carins",   name: "Car Insurance",     kind: "expense" },
  { id: "cat_carserv",  name: "Car Servicing",     kind: "expense" },
  { id: "cat_carlic",   name: "Car Licensing",     kind: "expense" },
  { id: "cat_dentist",  name: "Dentist",           kind: "expense" },
  { id: "cat_optho",    name: "Ophthalmologist",   kind: "expense" },
  { id: "cat_homeins",  name: "Home Insurance",    kind: "expense" },
  { id: "cat_tennis",   name: "Tennis Club",       kind: "expense" },
  { id: "cat_chess",    name: "Chess.com",         kind: "expense" },
  { id: "cat_google",   name: "Google One",        kind: "expense" },
  { id: "cat_transfer", name: "Transfer (own accounts)", kind: "transfer" },
  { id: "cat_invest",   name: "Investment Contribution", kind: "transfer" },
  { id: "cat_uncat",    name: "Uncategorised",     kind: "expense" },
];

const seedAccounts = [
  { id: "acc_bank",   name: "Main Bank Account",  type: "bank",       openingC: 4250000, openingYm: ymAdd(CUR_YM, -6) },
  { id: "acc_cc",     name: "Credit Card",        type: "credit",     openingC: -1820000, openingYm: ymAdd(CUR_YM, -6) },
  { id: "acc_invest", name: "Investment Portfolio", type: "investment", openingC: 68500000, openingYm: ymAdd(CUR_YM, -6) },
  { id: "acc_crypto", name: "Crypto Wallet",      type: "crypto",     openingC: 3200000, openingYm: ymAdd(CUR_YM, -6) },
];

/* Table 1 — regular monthly income/expenses */
const seedRecurring = [
  { id: uid("rec"), name: "Salary",           categoryId: "cat_salary",  amountC:  8500000, day: 25 },
  { id: uid("rec"), name: "Cleaning",         categoryId: "cat_cleaning",amountC:  -280000, day: 1 },
  { id: uid("rec"), name: "Gardening",        categoryId: "cat_garden",  amountC:  -160000, day: 1 },
  { id: uid("rec"), name: "Gas",              categoryId: "cat_gas",     amountC:   -95000, day: 5 },
  { id: uid("rec"), name: "Electricity",      categoryId: "cat_elec",    amountC:  -240000, day: 5 },
  { id: uid("rec"), name: "Medical",          categoryId: "cat_medical", amountC:  -520000, day: 1 },
  { id: uid("rec"), name: "Food",             categoryId: "cat_food",    amountC: -1100000, day: 15 },
  { id: uid("rec"), name: "Mortgage",         categoryId: "cat_mortgage",amountC: -1850000, day: 1 },
  { id: uid("rec"), name: "Credit Card",      categoryId: "cat_ccpay",   amountC: -1600000, day: 27 },
  { id: uid("rec"), name: "Water",            categoryId: "cat_water",   amountC:   -85000, day: 5 },
  { id: uid("rec"), name: "Netflix",          categoryId: "cat_netflix", amountC:   -19900, day: 12 },
  { id: uid("rec"), name: "PlayStation",      categoryId: "cat_ps",      amountC:   -16900, day: 18 },
  { id: uid("rec"), name: "Fuel",             categoryId: "cat_fuel",    amountC:  -220000, day: 15 },
  { id: uid("rec"), name: "Haircut",          categoryId: "cat_haircut", amountC:   -35000, day: 20 },
  { id: uid("rec"), name: "General Expenses", categoryId: "cat_general", amountC:  -450000, day: 15 },
];

/* Table 3 — annual / irregular outgoings (month = 1..12, escalation % p.a.) */
const seedAnnual = [
  { id: uid("ann"), name: "Car Insurance",   categoryId: "cat_carins",  month: 3,  amountC: -1450000, escalationPct: 6 },
  { id: uid("ann"), name: "Car Servicing",   categoryId: "cat_carserv", month: 8,  amountC:  -680000, escalationPct: 6 },
  { id: uid("ann"), name: "Car Licensing",   categoryId: "cat_carlic",  month: 5,  amountC:   -72000, escalationPct: 5 },
  { id: uid("ann"), name: "Dentist",         categoryId: "cat_dentist", month: 9,  amountC:  -180000, escalationPct: 7 },
  { id: uid("ann"), name: "Ophthalmologist", categoryId: "cat_optho",   month: 10, amountC:  -240000, escalationPct: 7 },
  { id: uid("ann"), name: "Home Insurance",  categoryId: "cat_homeins", month: 1,  amountC:  -960000, escalationPct: 8 },
  { id: uid("ann"), name: "Tennis Club",     categoryId: "cat_tennis",  month: 2,  amountC:  -420000, escalationPct: 5 },
  { id: uid("ann"), name: "Chess.com",       categoryId: "cat_chess",   month: 6,  amountC:   -99900, escalationPct: 0 },
  { id: uid("ann"), name: "Google One",      categoryId: "cat_google",  month: 7,  amountC:   -42900, escalationPct: 0 },
];

/* merchant → category rules used by the import auto-categoriser */
const seedRules = [
  { id: uid("rule"), pattern: "ACME PAYROLL",   categoryId: "cat_salary" },
  { id: uid("rule"), pattern: "WOOLWORTHS",     categoryId: "cat_food" },
  { id: uid("rule"), pattern: "CHECKERS",       categoryId: "cat_food" },
  { id: uid("rule"), pattern: "PICK N PAY",     categoryId: "cat_food" },
  { id: uid("rule"), pattern: "NETFLIX",        categoryId: "cat_netflix" },
  { id: uid("rule"), pattern: "PLAYSTATION",    categoryId: "cat_ps" },
  { id: uid("rule"), pattern: "SHELL",          categoryId: "cat_fuel" },
  { id: uid("rule"), pattern: "ENGEN",          categoryId: "cat_fuel" },
  { id: uid("rule"), pattern: "BP ",            categoryId: "cat_fuel" },
  { id: uid("rule"), pattern: "CITY OF",        categoryId: "cat_water" },
  { id: uid("rule"), pattern: "ESKOM",          categoryId: "cat_elec" },
  { id: uid("rule"), pattern: "BOND REPAYMENT", categoryId: "cat_mortgage" },
  { id: uid("rule"), pattern: "DISCOVERY",      categoryId: "cat_medical" },
  { id: uid("rule"), pattern: "GOOGLE ONE",     categoryId: "cat_google" },
  { id: uid("rule"), pattern: "CHESS.COM",      categoryId: "cat_chess" },
  { id: uid("rule"), pattern: "CC PAYMENT",     categoryId: "cat_ccpay" },
];

/* Table 4 — current-month actuals (seed: as if last import already happened) */
const D = (day) => `${CUR_YM}-${String(day).padStart(2, "0")}`;
const seedTxns = [
  { id: uid("txn"), accountId: "acc_bank", date: D(1),  desc: "BOND REPAYMENT HOMELOAN",   amountC: -1850000, categoryId: "cat_mortgage", source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_bank", date: D(1),  desc: "DEBIT ORDER DISCOVERY MED", amountC:  -524500, categoryId: "cat_medical",  source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_bank", date: D(1),  desc: "EFT MARIA CLEANING",        amountC:  -280000, categoryId: "cat_cleaning", source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_bank", date: D(2),  desc: "EFT GARDEN SERVICE",        amountC:  -160000, categoryId: "cat_garden",   source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_bank", date: D(5),  desc: "CITY OF CPT WATER",         amountC:   -91200, categoryId: "cat_water",    source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_bank", date: D(5),  desc: "ESKOM PREPAID ELEC",        amountC:  -262100, categoryId: "cat_elec",     source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_cc",   date: D(3),  desc: "WOOLWORTHS CLAREMONT",      amountC:  -184530, categoryId: "cat_food",     source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_cc",   date: D(7),  desc: "CHECKERS HYPER",            amountC:  -238910, categoryId: "cat_food",     source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_cc",   date: D(9),  desc: "SHELL ULTRA CITY",          amountC:  -118400, categoryId: "cat_fuel",     source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_cc",   date: D(12), desc: "NETFLIX.COM",               amountC:   -19900, categoryId: "cat_netflix",  source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_cc",   date: D(10), desc: "TAKEALOT ONLINE",           amountC:  -134900, categoryId: "cat_general",  source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_cc",   date: D(11), desc: "GOOGLE ONE STORAGE",        amountC:   -42900, categoryId: "cat_google",   source: "import", batchId: "batch_seed" },
  { id: uid("txn"), accountId: "acc_bank", date: D(6),  desc: "TRANSFER TO INVESTMENT",    amountC:  -500000, categoryId: "cat_invest",   source: "import", batchId: "batch_seed", transfer: true },
];
const seedBatches = [
  { id: "batch_seed", filename: "bank+cc statements (seed demo)", when: `${D(13)} 09:12`, count: seedTxns.length, accountIds: ["acc_bank", "acc_cc"] },
];
const seedSnapshots = [
  { id: uid("snap"), accountId: "acc_invest", date: `${ymAdd(CUR_YM,-3)}-28`, balanceC: 65200000 },
  { id: uid("snap"), accountId: "acc_invest", date: `${ymAdd(CUR_YM,-1)}-28`, balanceC: 67900000 },
  { id: uid("snap"), accountId: "acc_invest", date: D(1),  balanceC: 68500000 },
  { id: uid("snap"), accountId: "acc_crypto", date: `${ymAdd(CUR_YM,-2)}-15`, balanceC: 2800000 },
  { id: uid("snap"), accountId: "acc_crypto", date: D(2),  balanceC: 3200000 },
];

const initialState = {
  settings: { currency: "R", currentAge: 42, retirementAge: 65, planningAge: 90, inflationPct: 5.0, investReturnPct: 9.0, cashReturnPct: 4.0, cryptoReturnPct: 9.0, dayFirstDates: true, theme: "dark" },
  comp: { salaryMonthlyC: 8500000, bonusTargetPct: 15, bonusMonth: 12, salaryGrowthPct: 5.5 }, // Table 5
  mortgage: { balanceC: 185000000, ratePct: 10.5, termMonths: 216, fixedExpiry: ymAdd(CUR_YM, 14), paymentOverrideC: 1850000, propertyValueC: 320000000 },
  categories: seedCategories,
  accounts: seedAccounts,
  recurring: seedRecurring,
  annual: seedAnnual,
  rules: seedRules,
  txns: seedTxns,
  snapshots: seedSnapshots,
  batches: seedBatches,
  audit: [
    { id: uid("aud"), when: `${D(13)} 09:12`, kind: "import", detail: `Committed seed batch: ${seedTxns.length} transactions across 2 accounts` },
  ],
  scenario: { enabled: false, salaryPct: 0, spendPct: 0, inflationDelta: 0, rateDelta: 0, returnDelta: 0 },
};

/* ============================================================
   ENGINES — pure functions over the data model
   ============================================================ */
export const isFlow = (t, cats) => {
  if (t.excluded || t.transfer) return false;
  const c = cats.find((x) => x.id === t.categoryId);
  return !c || c.kind !== "transfer";
};

export const accountBalance = (acc, txns, snapshots, uptoDate) => {
  if (acc.type === "investment" || acc.type === "crypto") {
    const snaps = snapshots.filter((s) => s.accountId === acc.id && (!uptoDate || s.date <= uptoDate)).sort((a, b) => a.date.localeCompare(b.date));
    if (snaps.length) return snaps[snaps.length - 1].balanceC;
    return acc.openingC;
  }
  const sum = txns.filter((t) => t.accountId === acc.id && !t.excluded && (!uptoDate || t.date <= uptoDate)).reduce((s, t) => s + t.amountC, 0);
  return acc.openingC + sum;
};

export const monthlyPayment = (balanceC, ratePct, termMonths) => {
  const r = ratePct / 100 / 12;
  if (termMonths <= 0) return 0;
  if (r === 0) return Math.round(balanceC / termMonths);
  const f = Math.pow(1 + r, termMonths);
  return Math.round((balanceC * r * f) / (f - 1));
};

export const amortise = (mortgage, months, rateOverridePct) => {
  const rows = [];
  let bal = mortgage.balanceC;
  const rate = rateOverridePct ?? mortgage.ratePct;
  const pay = mortgage.paymentOverrideC || monthlyPayment(bal, rate, mortgage.termMonths);
  const r = rate / 100 / 12;
  for (let i = 0; i < months && bal > 0; i++) {
    const interest = Math.round(bal * r);
    const principal = Math.min(bal, pay - interest);
    bal = Math.max(0, bal - principal);
    if (bal > 0 && bal < 1000) { bal = 0; } // clamp sub-R10 rounding tail
    rows.push({ ym: ymAdd(nowYm(), i), interestC: interest, principalC: principal, paymentC: interest + principal, balanceC: bal });
  }
  return { rows, paymentC: pay };
};

/* recurring / annual matching against actuals for a given month */
export const matchRecurring = (item, txns, ym, cats) => {
  const hits = txns.filter((t) => !t.excluded && t.categoryId === item.categoryId && t.date.slice(0, 7) === ym);
  const actualC = hits.reduce((s, t) => s + t.amountC, 0);
  const paid = hits.length > 0;
  const varianceC = paid ? actualC - item.amountC : 0;
  const material = paid && Math.abs(varianceC) > Math.max(Math.abs(item.amountC) * 0.1, 10000);
  return { hits, actualC, paid, varianceC, material };
};
export const matchAnnual = (item, txns, year) => {
  const ym = `${year}-${String(item.month).padStart(2, "0")}`;
  const hits = txns.filter((t) => !t.excluded && t.categoryId === item.categoryId && t.date.slice(0, 7) === ym);
  const actualC = hits.reduce((s, t) => s + t.amountC, 0);
  return { ym, hits, actualC, paid: hits.length > 0, varianceC: hits.length ? actualC - item.amountC : 0 };
};

/* 12-month forecast, starting at the current month. Elapsed months are outside
   the window; the current month blends actuals with plan, later months are plan. */
export const buildForecast = (state, scenario) => {
  const { recurring, annual, txns, categories, comp, mortgage } = state;
  const sc = scenario || { salaryPct: 0, spendPct: 0, inflationDelta: 0, rateDelta: 0, returnDelta: 0 };
  const startYm = nowYm();
  const mortPay = mortgage.paymentOverrideC || monthlyPayment(mortgage.balanceC, mortgage.ratePct, mortgage.termMonths);
  const mortPayAdj = mortgage.paymentOverrideC && sc.rateDelta === 0
    ? mortPay
    : monthlyPayment(mortgage.balanceC, mortgage.ratePct + sc.rateDelta, mortgage.termMonths);

  const rows = [];
  let cum = 0;
  for (let i = 0; i < 12; i++) {
    const ym = ymAdd(startYm, i);
    const year = +ym.slice(0, 4);
    let planIn = 0, planOut = 0;
    recurring.forEach((r) => {
      const cat = categories.find((c) => c.id === r.categoryId);
      if (cat && cat.kind === "transfer") return; // credit-card payment & transfers are not net flows
      let amt = r.amountC;
      if (r.categoryId === "cat_salary") amt = Math.round(comp.salaryMonthlyC * (1 + sc.salaryPct / 100));
      else if (r.categoryId === "cat_mortgage") amt = -mortPayAdj;
      else if (amt < 0) amt = Math.round(amt * (1 + sc.spendPct / 100));
      if (amt >= 0) planIn += amt; else planOut += amt;
    });
    // bonus month
    if (+ym.slice(5) === comp.bonusMonth) {
      planIn += Math.round(comp.salaryMonthlyC * (1 + sc.salaryPct / 100) * 12 * (comp.bonusTargetPct / 100) / 1);
    }
    annual.forEach((a) => {
      if (+ym.slice(5) !== a.month) return;
      const yearsOut = year - +startYm.slice(0, 4);
      let amt = Math.round(a.amountC * Math.pow(1 + (a.escalationPct + sc.inflationDelta) / 100, Math.max(0, yearsOut)));
      amt = Math.round(amt * (1 + sc.spendPct / 100));
      planOut += amt;
    });

    // actuals for this month (only meaningful for current/past months)
    const monthTxns = txns.filter((t) => t.date.slice(0, 7) === ym && isFlow(t, categories));
    const actIn = monthTxns.filter((t) => t.amountC > 0).reduce((s, t) => s + t.amountC, 0);
    const actOut = monthTxns.filter((t) => t.amountC < 0).reduce((s, t) => s + t.amountC, 0);
    const isCurrent = ym === startYm;
    const hasActuals = monthTxns.length > 0 && ym <= startYm;

    // blend: current month = actuals for matched recurring items + plan for still-pending ones
    let usedIn = planIn, usedOut = planOut, mode = "plan";
    if (hasActuals && isCurrent) {
      let blendIn = 0, blendOut = 0;
      recurring.forEach((r) => {
        const cat = categories.find((c) => c.id === r.categoryId);
        if (cat && cat.kind === "transfer") return;
        const m = matchRecurring(r, txns, ym, categories);
        const amt = m.paid ? m.actualC : (r.categoryId === "cat_mortgage" ? -mortPayAdj : r.amountC);
        if (amt >= 0) blendIn += amt; else blendOut += amt;
      });
      annual.forEach((a) => {
        if (+ym.slice(5) !== a.month) return;
        const m = matchAnnual(a, txns, year);
        blendOut += m.paid ? m.actualC : a.amountC;
      });
      // unplanned actual spend (categorised outside the recurring/annual model)
      const modelCats = new Set([...recurring.map((r) => r.categoryId), ...annual.map((a) => a.categoryId)]);
      monthTxns.forEach((t) => {
        if (!modelCats.has(t.categoryId)) { if (t.amountC >= 0) blendIn += t.amountC; else blendOut += t.amountC; }
      });
      usedIn = blendIn; usedOut = blendOut; mode = "blend";
    }
    const net = usedIn + usedOut;
    cum += net;
    rows.push({ ym, planIn, planOut, actIn, actOut, usedIn, usedOut, net, cum, mode,
      planNet: planIn + planOut, varianceC: mode !== "plan" ? net - (planIn + planOut) : 0 });
  }
  return { rows, mortPay: mortPayAdj };
};

/* Long-term annual projection to planning age */
export const buildLongTerm = (state, scenario) => {
  const { settings: st, comp, mortgage, recurring, annual, accounts, txns, snapshots, categories } = state;
  const sc = scenario || { salaryPct: 0, spendPct: 0, inflationDelta: 0, rateDelta: 0, returnDelta: 0 };
  const infl = (st.inflationPct + sc.inflationDelta) / 100;
  const ret = (st.investReturnPct + sc.returnDelta) / 100;
  const cryptoRet = (st.cryptoReturnPct + sc.returnDelta) / 100;
  const cashRet = st.cashReturnPct / 100;

  let cash = 0, invest = 0, crypto = 0;
  accounts.forEach((a) => {
    const b = accountBalance(a, txns, snapshots);
    if (a.type === "investment") invest += b;
    else if (a.type === "crypto") crypto += b;
    else cash += b; // bank + credit card net
  });

  let salaryAnnual = Math.round(comp.salaryMonthlyC * 12 * (1 + sc.salaryPct / 100));
  const bonusPct = comp.bonusTargetPct / 100;
  let recurringSpendAnnual = recurring
    .filter((r) => { const c = categories.find((x) => x.id === r.categoryId); return r.amountC < 0 && r.categoryId !== "cat_mortgage" && (!c || c.kind !== "transfer"); })
    .reduce((s, r) => s + Math.abs(r.amountC), 0) * 12;
  recurringSpendAnnual = Math.round(recurringSpendAnnual * (1 + sc.spendPct / 100));
  let annualSpend = annual.reduce((s, a) => s + Math.abs(a.amountC), 0);
  annualSpend = Math.round(annualSpend * (1 + sc.spendPct / 100));

  let mortBal = mortgage.balanceC;
  let propVal = mortgage.propertyValueC || 0;
  const mortRate = (mortgage.ratePct + sc.rateDelta) / 100;
  const mortPayA = (mortgage.paymentOverrideC || monthlyPayment(mortgage.balanceC, mortgage.ratePct + sc.rateDelta, mortgage.termMonths)) * 12;

  const rows = [];
  const years = st.planningAge - st.currentAge;
  let depletionAge = null;
  const y0 = +nowYm().slice(0, 4);
  for (let i = 0; i <= years; i++) {
    const age = st.currentAge + i;
    const retired = age >= st.retirementAge;
    const income = retired ? 0 : Math.round(salaryAnnual * (1 + bonusPct));
    // mortgage amortisation (annual, approximate monthly compounding)
    let mortPaid = 0;
    if (mortBal > 0) {
      let b = mortBal;
      for (let m = 0; m < 12 && b > 0; m++) {
        const int_ = Math.round((b * mortRate) / 12);
        const pay = Math.min(b + int_, mortPayA / 12);
        b = Math.max(0, b + int_ - pay);
        mortPaid += pay;
      }
      mortBal = b;
    }
    const spend = recurringSpendAnnual + annualSpend + mortPaid;
    const net = income - spend;
    // apply growth to balances, then absorb surplus/shortfall
    cash = Math.round(cash * (1 + cashRet)) + net;
    invest = Math.round(invest * (1 + ret));
    crypto = Math.round(crypto * (1 + cryptoRet));
    if (cash < 0) { // draw down investments, then crypto
      const need = -cash;
      const fromInvest = Math.min(invest, need);
      invest -= fromInvest; cash += fromInvest;
      if (cash < 0) { const fromCrypto = Math.min(crypto, -cash); crypto -= fromCrypto; cash += fromCrypto; }
    }
    const liquid = cash + invest + crypto;
    const assets = liquid + propVal;
    const netWorth = assets - mortBal;
    if (depletionAge === null && retired && liquid <= 0) depletionAge = age;
    rows.push({ year: y0 + i, age, retired, incomeC: income, spendC: spend, netC: net,
      cashC: cash, investC: invest, cryptoC: crypto, propertyC: propVal, mortC: mortBal, assetsC: assets, liquidC: liquid, netWorthC: netWorth });
    // escalate for next year
    if (!retired) salaryAnnual = Math.round(salaryAnnual * (1 + comp.salaryGrowthPct / 100));
    recurringSpendAnnual = Math.round(recurringSpendAnnual * (1 + infl));
    annualSpend = Math.round(annualSpend * (1 + infl));
    propVal = Math.round(propVal * (1 + infl));
  }
  return { rows, depletionAge };
};

/* ---- CSV export helpers ---- */
const downloadCSV = (filename, headers, rows) => {
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [headers.join(","), ...rows.map((r) => r.map(esc).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
};

/* ---- OFX/QFX parsing ---- */
export const parseOFX = (text) => {
  const out = [];
  const blocks = text.split(/<STMTTRN>/i).slice(1);
  blocks.forEach((b) => {
    const g = (tag) => { const m = b.match(new RegExp(`<${tag}>([^<\\r\\n]+)`, "i")); return m ? m[1].trim() : ""; };
    const date = parseDateAny(g("DTPOSTED").slice(0, 8));
    const amt = toC(g("TRNAMT"));
    const desc = g("NAME") || g("MEMO") || "OFX transaction";
    if (date) out.push({ date, desc, amountC: amt });
  });
  return out;
};

export default function App({ boot = null, onPersist = null }) {
  const [state, setState] = useState(boot || initialState);
  const booted = useRef(false);
  useEffect(() => {
    if (!booted.current) { booted.current = true; return; } // don't save the freshly-loaded state
    if (onPersist) onPersist(state);
  }, [state, onPersist]);
  const [page, setPage] = useState("overview");
  const [ym, setYm] = useState(nowYm());
  const [txnFilter, setTxnFilter] = useState({ account: "all", category: "all", search: "" });
  const cur = state.settings.currency;
  const cats = state.categories;
  const catName = (id) => (cats.find((c) => c.id === id) || {}).name || "—";
  const accName = (id) => (state.accounts.find((a) => a.id === id) || {}).name || "—";

  const log = (kind, detail) => (s) => ({ ...s, audit: [{ id: uid("aud"), when: new Date().toISOString().slice(0, 16).replace("T", " "), kind, detail }, ...s.audit] });
  const update = (fn, kind, detail) => setState((s) => (kind ? log(kind, detail)(fn(s)) : fn(s)));

  /* Theme. Resolved once: the localStorage mirror wins because index.html has
     already painted with it, then the persisted setting (absent on rows saved
     before this feature), then dark. The setting is still written to state so
     it travels with the account — but with no audit `kind`, because a colour
     preference does not belong in a financial audit trail. */
  const [theme, setThemeState] = useState(() => readStoredTheme() ?? state.settings.theme ?? "dark");
  const setTheme = (next) => {
    setThemeState(next);
    update((s) => ({ ...s, settings: { ...s.settings, theme: next } }));
  };
  useEffect(() => { applyTheme(theme); storeTheme(theme); }, [theme]);
  const palette = CHART[theme] || CHART.dark;

  const goTxns = (filter) => { setTxnFilter({ account: "all", category: "all", search: "", ...filter }); setPage("transactions"); };

  const fc = useMemo(() => buildForecast(state, null), [state]);
  const fcScen = useMemo(() => (state.scenario.enabled ? buildForecast(state, state.scenario) : null), [state]);
  const lt = useMemo(() => buildLongTerm(state, null), [state]);
  const ltScen = useMemo(() => (state.scenario.enabled ? buildLongTerm(state, state.scenario) : null), [state]);

  const netWorth = useMemo(() => {
    let assets = 0, liab = 0;
    state.accounts.forEach((a) => { const b = accountBalance(a, state.txns, state.snapshots); if (b >= 0) assets += b; else liab += b; });
    assets += state.mortgage.propertyValueC || 0;
    liab += -state.mortgage.balanceC;
    return { assets, liab, total: assets + liab };
  }, [state]);

  const monthTxns = useMemo(() => state.txns.filter((t) => t.date.slice(0, 7) === ym), [state.txns, ym]);
  const monthSpend = monthTxns.filter((t) => isFlow(t, cats) && t.amountC < 0).reduce((s, t) => s + t.amountC, 0);
  const monthIncome = monthTxns.filter((t) => isFlow(t, cats) && t.amountC > 0).reduce((s, t) => s + t.amountC, 0);
  const budgetOut = state.recurring.filter((r) => { const c = cats.find((x) => x.id === r.categoryId); return r.amountC < 0 && (!c || c.kind !== "transfer"); }).reduce((s, r) => s + r.amountC, 0)
    + state.annual.filter((a) => a.month === +ym.slice(5)).reduce((s, a) => s + a.amountC, 0);

  const NAV = [
    ["overview", "Overview", "◈"], ["transactions", "Transactions", "≣"], ["accounts", "Accounts", "⛁"],
    ["recurring", "Recurring Cashflow", "↻"], ["annual", "Annual Expenses", "◔"], ["compensation", "Compensation", "◉"],
    ["forecast", "Forecast", "⟋"], ["longterm", "Long-Term Plan", "∞"], ["imports", "Imports", "⇪"], ["settings", "Settings", "⚙"],
  ];
  const showMonthSel = ["overview", "transactions", "forecast", "annual"].includes(page);

  return (
    <div className="app">
      <style>{THEME_CSS + CSS}</style>
      <nav className="nav" aria-label="Sections">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">▚</div>
          <div><div className="brand-name">LEDGERLINE</div><div className="brand-sub">personal finance model</div></div>
        </div>
        {NAV.map(([k, label, ic]) => (
          <button key={k} className={`nav-item ${page === k ? "on" : ""}`} aria-current={page === k ? "page" : undefined}
            onClick={() => setPage(k)}>
            <span className="nav-ic" aria-hidden="true">{ic}</span>{label}
            {k === "imports" && <span className="nav-badge">{state.batches.length}<span className="sr-only"> statement imports so far</span></span>}
          </button>
        ))}
        {/* "in-memory" was flatly untrue for a signed-in user, whose every edit
            is saved. Say what is true of both cases instead. */}
        <div className="nav-foot">Signed in, every change is saved to your account.<br />In demo mode nothing is saved.</div>
      </nav>

      <main className="main">
        <header className="topbar">
          <h1 className="crumb">{NAV.find((n) => n[0] === page)?.[1]}</h1>
          {showMonthSel && (
            <div className="month-sel">
              <button aria-label={`Previous month, ${ymLabel(ymAdd(ym, -1))}`} onClick={() => setYm(ymAdd(ym, -1))}>
                <span aria-hidden="true">‹</span>
              </button>
              <span>{ymLabel(ym)}</span>
              <button aria-label={`Next month, ${ymLabel(ymAdd(ym, 1))}`} onClick={() => setYm(ymAdd(ym, 1))}>
                <span aria-hidden="true">›</span>
              </button>
              {ym !== nowYm() && <button className="today" aria-label={`Back to this month, ${ymLabel(nowYm())}`} onClick={() => setYm(nowYm())}>today</button>}
            </div>
          )}
          <div className="scen-pill" data-on={state.scenario.enabled}>
            {state.scenario.enabled ? "SCENARIO ON" : "NO SCENARIO"}
            <Help of="the scenario indicator" text={state.scenario.enabled
              ? "A what-if scenario is switched on. Its figures are drawn alongside your own on the Forecast and Long-Term Plan pages — your saved model is not changed."
              : "Everything shown is your own figures. Set up a what-if under Forecast or Long-Term Plan to compare against them."} />
          </div>
        </header>

        {page === "overview" && <Overview {...{ state, cur, ym, netWorth, monthSpend, monthIncome, budgetOut, fc, lt, goTxns, cats, catName, palette }} />}
        {page === "transactions" && <Transactions {...{ state, update, cur, ym, txnFilter, setTxnFilter, cats, catName, accName }} />}
        {page === "accounts" && <Accounts {...{ state, update, cur, goTxns, palette }} />}
        {page === "recurring" && <Recurring {...{ state, update, cur, ym, cats }} />}
        {page === "annual" && <Annual {...{ state, update, cur, ym, cats, goTxns }} />}
        {page === "compensation" && <Compensation {...{ state, update, cur, palette }} />}
        {page === "forecast" && <Forecast {...{ state, update, cur, fc, fcScen, palette }} />}
        {page === "longterm" && <LongTerm {...{ state, update, cur, lt, ltScen, palette }} />}
        {page === "imports" && <Imports {...{ state, update, cur, cats, catName, accName }} />}
        {page === "settings" && <Settings {...{ state, update, cur, fc, lt, catName, accName, theme, setTheme }} />}
      </main>
    </div>
  );
}

/* ============================================================
   SHARED UI
   ============================================================ */
const Card = ({ title, right, children, className = "" }) => (
  <section className={`card ${className}`}>
    {(title || right) && <div className="card-head"><h2>{title}</h2><div>{right}</div></div>}
    {children}
  </section>
);
/* `help` hangs an explanation off the label — every stat on this app shows a
   number whose derivation is invisible, and there is no room to spell it out in
   a 170px tile. It was a `title`, which only a mouse can reach: a keyboard or
   touch user got none of it. It is a real disclosure button now, so the text is
   reachable by Tab + Enter and by tapping, and the panel is ordinary text an
   assistive technology reads out. The hover `title` stays as a mouse shortcut. */
const Help = ({ text, of }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="help-wrap">
      <button type="button" className="help" title={text} aria-expanded={open}
        aria-label={of ? `Explain ${of}` : "Explain this figure"}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}>?</button>
      {open && <span className="help-body">{text}</span>}
    </span>
  );
};
/* A tile that navigates somewhere is a control, and has to say so: it is a real
   button when — and only when — it was given an onClick. A tile that only shows
   a figure stays a plain div, so it is never announced as something to press.
   The `?` sits outside the button: a focusable control cannot be nested inside
   another one. */
const Stat = ({ label, value, sub, tone, onClick, help }) => {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className={`stat-value ${tone || ""}`}>{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </>
  );
  return (
    <div className={`stat ${onClick ? "click" : ""}`}>
      {onClick
        ? <button type="button" className="stat-hit" onClick={onClick}>{body}</button>
        : <span className="stat-hit">{body}</span>}
      {help && <Help text={help} of={label} />}
    </div>
  );
};
/* A table has no width of its own to give away. Below the width its columns
   need it simply stops shrinking, and — with no scroll container anywhere in
   the app — pushes the whole document sideways instead. The .topbar and the
   sidebar are sticky, so they stay pinned while the content slides out from
   under them: the page comes apart rather than degrading. Every table sits in
   one of these now, so a table too wide for its card spends the overflow
   inside the card.

   A region that scrolls has to be reachable from a keyboard, so it becomes a
   focusable, named region — but only while it actually overflows, so a table
   that fits leaves no empty tab stop behind. For the same reason it only
   clips while it overflows: clipping a table that fits would cut off the
   explanation panels that hang out of its header cells for nothing. */
const TableScroll = ({ label, maxHeight, children }) => {
  const ref = useRef(null);
  const [scrolls, setScrolls] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrolls(el.scrollWidth > el.clientWidth + 1);
    check();
    if (typeof ResizeObserver === "undefined") return; // jsdom, older Safari
    const ro = new ResizeObserver(check);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={`tbl-wrap ${scrolls ? "on" : ""} ${maxHeight ? "capped" : ""}`}
      style={maxHeight ? { maxHeight } : undefined}
      tabIndex={scrolls ? 0 : undefined} role={scrolls ? "region" : undefined}
      aria-label={scrolls ? `${label} — wider than the screen, scrolls sideways` : undefined}>
      {children}
    </div>
  );
};

/* Recharts emits a bare <svg> with no name and no text alternative, so a screen
   reader reader finds nothing at all where the chart is. Name the picture, and
   put a sentence next to it saying what it shows — pointing at the table with
   the same figures where the page already has one. */
const ChartFrame = ({ name, summary, children }) => (
  <>
    <div className="chart-frame" role="img" aria-label={name}>{children}</div>
    <p className="sr-only">{summary}</p>
  </>
);

/* Nothing in this app's CSS transitions or animates, so prefers-reduced-motion
   had nothing to switch off — except Recharts, which grows every bar, line and
   area in on mount and again on every data change, and has that on by default.
   Six charts do it. This is the switch. */
const useReducedMotion = () => {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    onChange();
    // Safari below 14 only has the deprecated form.
    if (mq.addEventListener) { mq.addEventListener("change", onChange); return () => mq.removeEventListener("change", onChange); }
    mq.addListener(onChange); return () => mq.removeListener(onChange);
  }, []);
  return reduced;
};

/* Money in and money out were told apart by hue alone. In the light palette the
   two measure 1.10:1 against each other, so to a deuteranope — or a greyscale
   printer — the bars are one colour. Money out is hatched now; the hue is the
   decoration, the texture is the signal. Ids are prefixed per chart because two
   charts share a document and `url(#id)` is document-wide.

   Called as a function rather than mounted as <ChartHatch/>: Recharts throws
   away any child whose type is not a literal SVG tag, so a wrapper component
   disappears without a word and the bars paint as nothing at all. */
const chartHatch = (id, palette) => (
  <defs key={`${id}-hatch`}>
    {["neg", "negPlan"].map((k) => (
      <pattern key={k} id={`${id}-${k}`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="8" height="8" fill={palette[k]} />
        <line x1="0" y1="0" x2="0" y2="8" stroke={palette.stripe} strokeWidth="3" />
      </pattern>
    ))}
  </defs>
);
const Amt = ({ c, cur, zero }) => (
  <span className={`amt ${c > 0 ? "pos" : c < 0 ? "neg" : ""}`}>{zero && c === 0 ? "—" : C(c, cur)}</span>
);
/* An unreadable entry is held in the field with a reason, never committed as a
   silent zero. The wrapper only appears while there is something to say, so a
   valid field lays out exactly as it did before. */
const withError = (input, err) =>
  err ? <span className="in-wrap">{input}<span className="in-err" role="alert">{err}</span></span> : input;

const NumInput = ({ valueC, onCommit, className = "", label, disabled }) => {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  return withError(
    <input className={`num-in ${className} ${err ? "invalid" : ""}`} value={v === null ? (valueC / 100).toFixed(2) : v}
      aria-label={label} disabled={disabled}
      onChange={(e) => { setV(e.target.value); setErr(null); }}
      onBlur={() => {
        if (v === null) return;
        if (!isReadableAmount(v)) { setErr("Not a number — nothing was saved."); return; }
        setErr(null); onCommit(toC(v)); setV(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />,
    err
  );
};
const PctInput = ({ value, onCommit, step = 0.1, min, max, validate, label, disabled }) => {
  const [v, setV] = useState(null);
  const [err, setErr] = useState(null);
  return withError(
    <input className={`num-in pct ${err ? "invalid" : ""}`} type="number" step={step} min={min} max={max}
      aria-label={label} disabled={disabled}
      value={v === null ? value : v}
      onChange={(e) => { setV(e.target.value); setErr(null); }}
      onBlur={() => {
        if (v === null) return;
        if (!isReadableNumber(v)) { setErr("Not a number — nothing was saved."); return; }
        const n = Number(v);
        const reason = validate ? validate(n) : null;
        if (reason) { setErr(reason); return; }
        setErr(null); onCommit(n); setV(null);
      }}
      onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />,
    err
  );
};
/* Deleting a row is immediate and there is no undo, so ✕ arms the row and a
   second click commits it. Two mini buttons in place of the ✕ — no modal
   library, no new dependency, and the row never moves. */
const DeleteCell = ({ what, onDelete }) => {
  const [armed, setArmed] = useState(false);
  const armRef = useRef(null);
  const confirmRef = useRef(null);
  const wasArmed = useRef(false);
  /* Arming used to be a purely visual event: the ✕ was replaced and focus fell
     back to the body, so a keyboard user lost their place and a screen reader
     said nothing. Move focus onto the confirmation and announce that the row is
     armed; put focus back on the ✕ when the answer is "keep". Both wait for the
     render that creates the button being focused — it does not exist yet at the
     moment the click is handled. */
  useEffect(() => {
    if (armed) { if (confirmRef.current) confirmRef.current.focus(); }
    else if (wasArmed.current && armRef.current) armRef.current.focus();
    wasArmed.current = armed;
  }, [armed]);
  return (
    <span className="del-cell">
      {/* Kept mounted so the text swap is a live-region update, not a new region */}
      <span className="sr-only" role="status">{armed ? `Delete “${what}”? Waiting for confirmation.` : ""}</span>
      {armed ? (
        <span className="confirm">
          <span className="confirm-q">Delete “{what}”?</span>
          <button ref={confirmRef} className="mini danger" aria-label={`Confirm delete “${what}”`}
            onClick={() => { setArmed(false); onDelete(); }}>Delete</button>
          <button className="mini" aria-label={`Keep “${what}”`} onClick={() => setArmed(false)}>Keep</button>
        </span>
      ) : (
        <button ref={armRef} className="mini" title={`Delete “${what}”`} aria-label={`Delete “${what}”`}
          onClick={() => setArmed(true)}>✕</button>
      )}
    </span>
  );
};

const chartTip = (cur) => ({ payload, label, active }) =>
  active && payload && payload.length ? (
    <div className="tip">
      <div className="tip-t">{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: {C0(p.value, cur)}</div>)}
    </div>
  ) : null;

/* ---- plain words for the internal tokens the model works in ----
   buildForecast only ever writes "plan" or "blend" into `mode` (there is no
   reachable "actual" month), so only those two are given words here. */
const BASIS_WORD = { plan: "planned", blend: "actual + planned" };
const BASIS_HELP = {
  plan: "Nothing has happened yet in this month, so every figure comes from your plan: recurring items, any annual item due, and the bonus if it falls here.",
  blend: "This month mixes money already in and out of your accounts with what is still expected before month end. Items you have not paid yet are still counted at their planned amount.",
};
const basisLegend = (
  <div className="legend">
    <span><span className="chip pending">{BASIS_WORD.blend}</span> the current month — money already spent and received, plus what is still expected before month end</span>
    <span><span className="chip ghost">{BASIS_WORD.plan}</span> every later month — entirely your plan, nothing has happened yet</span>
  </div>
);

/* Mirrors the thresholds already in the code — stated so the ⚠ and the amber
   are not a mystery. matchRecurring: Math.max(|amountC| * 0.1, 10000).
   Forecast "vs plan": Math.abs(varianceC) > Math.abs(planNet) * 0.1. */
const recurringVarianceHelp = (cur) =>
  `The gap between what you planned and what actually went through. Flagged ⚠ once the gap is more than 10% of the planned amount, or ${C0(10000, cur)} — whichever is the larger.`;
const forecastVarianceHelp = "How far this month has landed from the plan. Shown in amber once the gap is more than 10% of the planned net for the month.";

/* ============================================================
   PAGES
   ============================================================ */
function Overview({ state, cur, ym, netWorth, monthSpend, monthIncome, budgetOut, fc, lt, goTxns, cats, catName, palette }) {
  const still = useReducedMotion();
  const spendPct = budgetOut !== 0 ? Math.round((monthSpend / budgetOut) * 100) : 0;
  const byCat = {};
  state.txns.filter((t) => t.date.slice(0, 7) === ym && isFlow(t, cats) && t.amountC < 0)
    .forEach((t) => { byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amountC; });
  const catRows = Object.entries(byCat).map(([id, c]) => ({ id, name: catName(id), c })).sort((a, b) => a.c - b.c).slice(0, 8);

  const pendingRecurring = state.recurring.filter((r) => {
    const c = cats.find((x) => x.id === r.categoryId);
    if (c && c.kind === "transfer") return false;
    return !matchRecurring(r, state.txns, ym, cats).paid;
  });

  return (
    <div className="grid">
      <div className="stat-row">
        <Stat label="Net worth" value={C0(netWorth.total, cur)} sub={`${C0(netWorth.assets, cur)} assets · ${C0(netWorth.liab, cur)} liabilities`} tone="pos"
          help={"Everything you own, less everything you owe: account balances, plus the property value, less the mortgage balance (both set under Compensation). The two kinds of account balance look the same here but are not: bank and credit-card balances are the opening balance plus every transaction since, while investment and crypto balances are simply the last figure you entered yourself under Accounts, so they only move when you update them."} />
        <Stat label={`Income · ${ymShort(ym)}`} value={C0(monthIncome, cur)} tone="pos" onClick={() => goTxns({ search: "", category: "all" })}
          help={"Money in this month, added up from the transactions in the model. Money moved between your own accounts is left out, so a transfer in is not counted as income. Click to see the transactions."} />
        <Stat label={`Spend · ${ymShort(ym)}`} value={C0(monthSpend, cur)} tone="neg" sub={`${spendPct}% of ${C0(budgetOut, cur)} budgeted`} onClick={() => goTxns({})}
          help={"Money out this month, added up from the transactions in the model. The budget it is measured against is your recurring expense items plus any annual item falling in this month. Money moved between your own accounts is left out of both figures. Click to see the transactions."} />
        <Stat label="12-mo forecast net" value={C0(fc.rows[11].cum, cur)} sub="the 12 months added up" tone={fc.rows[11].cum >= 0 ? "pos" : "neg"}
          help={"The running total of the next 12 monthly nets from the Forecast page. It is how much better or worse off the year leaves you — not a balance, and not what you will have in the bank."} />
        <Stat label="Retirement depletion" value={lt.depletionAge ? `age ${lt.depletionAge}` : "clear"}
          sub={lt.depletionAge ? "assets exhausted" : `retired years only, to age ${state.settings.planningAge}`} tone={lt.depletionAge ? "warn" : "pos"}
          help={`This only looks at the retired years. It reports the first year, at or after your retirement age of ${state.settings.retirementAge}, in which your cash, investments and crypto together fall to zero. It does not check the years before you retire — so "clear" does not mean you cannot run short while still working. Your property is not counted either, because you would have to sell it to spend it.`} />
      </div>

      <Card title="12-month cashflow ribbon" className="span2"
        right={<span className="muted-s">full colour = actual + planned · pale = planned · hatched = a month that ends down<Help of="the bar shading" text={`${BASIS_HELP.blend}\n\n${BASIS_HELP.plan}\n\nA hatched bar is a month that ends with more going out than coming in. The hatching says so on its own, so the sign does not depend on telling the two bar colours apart.`} /></span>}>
        <ChartFrame name="12-month cashflow ribbon"
          summary={`A bar for each of the next 12 months showing money in less money out, with a line for the running total. The same figures are listed month by month in the table on the Forecast page. Over the 12 months the running total ends at ${C0(fc.rows[11].cum, cur)}.`}>
        <ResponsiveContainer width="100%" height={210}>
          <ComposedChart data={fc.rows.map((r) => ({ ...r, name: ymShort(r.ym) }))}>
            {chartHatch("ribbon", palette)}
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => C0(v, cur)} tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
            <Tooltip content={chartTip(cur)} />
            <ReferenceLine y={0} stroke={palette.zero} />
            <Bar dataKey="net" name="Net flow" radius={[3, 3, 0, 0]} isAnimationActive={!still}>
              {fc.rows.map((r, i) => <Cell key={i} fill={r.mode !== "plan" ? (r.net >= 0 ? palette.pos : "url(#ribbon-neg)") : (r.net >= 0 ? palette.posPlan : "url(#ribbon-negPlan)")} />)}
            </Bar>
            <Line dataKey="cum" name="Cumulative" stroke={palette.line} strokeWidth={2} dot={false} isAnimationActive={!still} />
          </ComposedChart>
        </ResponsiveContainer>
        </ChartFrame>
      </Card>

      <Card title={`Top spend categories · ${ymShort(ym)}`}>
        {catRows.length === 0 && <div className="empty">No categorised spend this month yet. Import a statement to populate actuals.</div>}
        {catRows.map((r) => (
          <button key={r.id} className="bar-row" onClick={() => goTxns({ category: r.id })}>
            <span>{r.name}</span>
            <span className="bar-track" aria-hidden="true"><span className="bar-fill" style={{ width: `${Math.min(100, (Math.abs(r.c) / Math.abs(catRows[0].c)) * 100)}%` }} /></span>
            <span className="amt neg">{C(r.c, cur)}</span>
            <span className="sr-only">— show these transactions</span>
          </button>
        ))}
      </Card>

      <Card title={`Still pending · ${ymShort(ym)}`} right={<span className="muted-s">{pendingRecurring.length} expected items unmatched</span>}>
        {pendingRecurring.length === 0 && <div className="empty">Every expected recurring item is matched to an actual. Fully reconciled month.</div>}
        {/* No header row by design — the columns are named in the caption instead,
            so the table is not four unlabelled columns to a screen reader. */}
        <TableScroll label="Still pending">
        <table className="tbl">
          <caption className="sr-only">
            Recurring items expected in {ymLabel(ym)} with no matching transaction yet. Columns: item, the day of
            the month it is expected, the planned amount, and its status.
          </caption>
          <tbody>
            {pendingRecurring.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="muted-s">expected day {r.day}</td>
                <td className="r"><Amt c={r.amountC} cur={cur} /></td>
                <td><span className="chip pending">pending</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
      </Card>

      <Card title="Net worth trajectory" className="span2">
        <ChartFrame name="Net worth trajectory by age"
          summary={`A filled line of projected net worth for every age from ${state.settings.currentAge} to ${state.settings.planningAge}, with a marker at the retirement age of ${state.settings.retirementAge}. The same figures are listed year by year in the Annual projection table on the Long-Term Plan page.`}>
        <ResponsiveContainer width="100%" height={190}>
          <AreaChart data={lt.rows.map((r) => ({ name: r.age, nw: r.netWorthC }))}>
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => C0(v, cur)} tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
            <Tooltip content={chartTip(cur)} />
            <ReferenceLine x={state.settings.retirementAge} stroke={palette.marker} strokeDasharray="4 3" label={{ value: "retire", fill: palette.marker, fontSize: 11 }} />
            <Area dataKey="nw" name="Net worth" stroke={palette.pos} fill="url(#nwg)" strokeWidth={2} isAnimationActive={!still} />
            <defs><linearGradient id="nwg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={palette.pos} stopOpacity={0.28} /><stop offset="100%" stopColor={palette.pos} stopOpacity={0.02} /></linearGradient></defs>
          </AreaChart>
        </ResponsiveContainer>
        </ChartFrame>
      </Card>
    </div>
  );
}

function Transactions({ state, update, cur, ym, txnFilter, setTxnFilter, cats, catName, accName }) {
  const f = txnFilter;
  const rows = state.txns
    .filter((t) => t.date.slice(0, 7) === ym)
    .filter((t) => f.account === "all" || t.accountId === f.account)
    .filter((t) => f.category === "all" || t.categoryId === f.category)
    .filter((t) => !f.search || t.desc.toLowerCase().includes(f.search.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));
  const total = rows.filter((t) => isFlow(t, cats)).reduce((s, t) => s + t.amountC, 0);

  const setTxn = (id, patch, auditMsg) =>
    update((s) => ({ ...s, txns: s.txns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }), "edit", auditMsg);

  return (
    <div className="grid">
      <Card className="span3" title={`Transactions · ${ymLabel(ym)}`} right={
        <div className="filters">
          {/* The placeholder was the only label on the search box; it disappears
              the moment anything is typed, so it never was one. */}
          <input aria-label="Search descriptions" placeholder="Search description…" value={f.search} onChange={(e) => setTxnFilter({ ...f, search: e.target.value })} />
          <select aria-label="Filter by account" value={f.account} onChange={(e) => setTxnFilter({ ...f, account: e.target.value })}>
            <option value="all">All accounts</option>
            {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select aria-label="Filter by category" value={f.category} onChange={(e) => setTxnFilter({ ...f, category: e.target.value })}>
            <option value="all">All categories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="muted-s">net <Amt c={total} cur={cur} /></span>
        </div>
      }>
        {rows.length === 0 && <div className="empty">No transactions for this month and filter. Use Imports to load a statement, or add one manually below.</div>}
        <TableScroll label="Transactions">
        <table className="tbl">
          <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col">Account</th><th scope="col">Category</th><th scope="col" className="r">Amount</th><th scope="col">Flags</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={t.excluded ? "dim" : ""}>
                <td className="mono">{t.date.slice(5)}</td>
                <td>{t.desc}</td>
                <td className="muted-s">{accName(t.accountId)}</td>
                <td>
                  <select className="cat-sel" aria-label={`Category for “${t.desc}”`} value={t.categoryId} onChange={(e) => setTxn(t.id, { categoryId: e.target.value }, `Recategorised "${t.desc}" → ${catName(e.target.value)}`)}>
                    {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td className="r"><Amt c={t.amountC} cur={cur} /></td>
                <td>
                  {t.transfer && <span className="chip transfer">transfer</span>}
                  {t.excluded && <span className="chip">excluded</span>}
                  {t.source === "import" && <span className="chip ghost">import</span>}
                </td>
                <td className="r">
                  <button className="mini" title="Mark as transfer between own accounts"
                    aria-label={`${t.transfer ? "Stop treating" : "Treat"} “${t.desc}” as a transfer between your own accounts`}
                    onClick={() => setTxn(t.id, { transfer: !t.transfer }, `${t.transfer ? "Unmarked" : "Marked"} "${t.desc}" as transfer`)}><span aria-hidden="true">⇄</span></button>
                  <button className="mini" title="Exclude from all analysis"
                    aria-label={t.excluded ? `Put “${t.desc}” back into the analysis` : `Leave “${t.desc}” out of all analysis`}
                    onClick={() => setTxn(t.id, { excluded: !t.excluded }, `${t.excluded ? "Restored" : "Excluded"} "${t.desc}"`)}><span aria-hidden="true">{t.excluded ? "↺" : "✕"}</span></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
        <AddTxn state={state} update={update} ym={ym} cats={cats} />
      </Card>
    </div>
  );
}

function AddTxn({ state, update, ym, cats }) {
  const first = state.accounts[0];
  const [d, setD] = useState({ date: `${ym}-15`, desc: "", amount: "", accountId: first ? first.id : "", categoryId: "cat_uncat" });
  // A transaction has to land in an account, and this model holds none.
  if (!first) return (
    <div className="add-row">
      <span className="muted-s">This model has no accounts, so there is nowhere to record a transaction.</span>
      <button className="btn" disabled>Add</button>
    </div>
  );
  // the account may have been added or removed since this row was first drawn
  const accountId = state.accounts.some((a) => a.id === d.accountId) ? d.accountId : first.id;
  const amountBad = d.amount !== "" && !isReadableAmount(d.amount);
  return (
    <div className="add-row">
      <input type="date" aria-label="Date of the new transaction" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
      <input aria-label="Description of the new transaction" placeholder="Description" value={d.desc} onChange={(e) => setD({ ...d, desc: e.target.value })} style={{ flex: 1 }} />
      <select aria-label="Account for the new transaction" value={accountId} onChange={(e) => setD({ ...d, accountId: e.target.value })}>{state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <select aria-label="Category for the new transaction" value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <span className="in-wrap">
        <input className={amountBad ? "invalid" : ""} aria-label="Amount of the new transaction, a minus sign for money out"
          placeholder="Amount (− = out)" value={d.amount}
          onChange={(e) => setD({ ...d, amount: e.target.value })} style={{ width: 130 }} />
        {amountBad && <span className="in-err" role="alert">Not a number.</span>}
      </span>
      <button className="btn" disabled={!d.desc.trim() || !isReadableAmount(d.amount)} onClick={() => {
        update((s) => ({ ...s, txns: [...s.txns, { id: uid("txn"), accountId, date: d.date, desc: d.desc, amountC: toC(d.amount), categoryId: d.categoryId, source: "manual" }] }), "manual", `Manual transaction "${d.desc}" ${d.amount}`);
        setD({ ...d, desc: "", amount: "" });
      }}>Add</button>
    </div>
  );
}

function Accounts({ state, update, cur, goTxns, palette }) {
  const still = useReducedMotion();
  const [recon, setRecon] = useState({});
  const [snap, setSnap] = useState({});
  const groups = [["bank", "Bank"], ["credit", "Credit cards"], ["investment", "Investments"], ["crypto", "Crypto"]];

  const history = (acc) => {
    const out = [];
    for (let i = 8; i >= 0; i--) {
      const m = ymAdd(nowYm(), -i);
      const lastDay = `${m}-31`;
      out.push({ name: ymShort(m), bal: accountBalance(acc, state.txns, state.snapshots, lastDay) });
    }
    return out;
  };

  return (
    <div className="grid">
      {groups.map(([type, label]) => (
        <React.Fragment key={type}>
          {state.accounts.filter((a) => a.type === type).map((acc) => {
            const bal = accountBalance(acc, state.txns, state.snapshots);
            const isSnap = type === "investment" || type === "crypto";
            const r = recon[acc.id] || {};
            const computedAt = r.date ? accountBalance(acc, state.txns, state.snapshots, r.date) : null;
            const diff = r.balance !== undefined && computedAt !== null ? toC(r.balance) - computedAt : null;
            return (
              <Card key={acc.id} title={<span><span className="acc-type">{label}</span>{acc.name}</span>}
                right={<button className="mini" aria-label={`View transactions for ${acc.name}`} onClick={() => goTxns({ account: acc.id })}>view txns →</button>}>
                <div className="acc-bal"><Amt c={bal} cur={cur} /></div>
                <ChartFrame name={`Balance of ${acc.name} over the last nine months`}
                  summary={`A line of the ${acc.name} balance at the end of each of the last nine months, from ${C0(history(acc)[0].bal, cur)} in ${history(acc)[0].name} to ${C0(bal, cur)} now.`}>
                <ResponsiveContainer width="100%" height={90}>
                  <AreaChart data={history(acc)}>
                    <XAxis dataKey="name" hide /><YAxis hide domain={["auto", "auto"]} />
                    <Tooltip content={chartTip(cur)} />
                    <Area dataKey="bal" name="Balance" stroke={bal >= 0 ? palette.pos : palette.neg} fill="none" strokeWidth={1.5} isAnimationActive={!still} />
                  </AreaChart>
                </ResponsiveContainer>
                </ChartFrame>
                {isSnap ? (
                  <div className="recon">
                    <div className="muted-s">Enter the balance yourself</div>
                    <div className="muted-s">This account's balance is whatever you last typed in here — it does not move on its own between updates.</div>
                    <div className="recon-row">
                      <input type="date" aria-label={`Date of the balance you are entering for ${acc.name}`} value={(snap[acc.id] || {}).date || todayISO()} onChange={(e) => setSnap({ ...snap, [acc.id]: { ...(snap[acc.id] || {}), date: e.target.value } })} />
                      <input aria-label={`Balance of ${acc.name} on that date`} placeholder="Balance" value={(snap[acc.id] || {}).balance || ""} onChange={(e) => setSnap({ ...snap, [acc.id]: { ...(snap[acc.id] || {}), balance: e.target.value } })} />
                      <button className="btn" aria-label={`Save this balance for ${acc.name}`} disabled={!(snap[acc.id] || {}).balance} onClick={() => {
                        const sv = snap[acc.id];
                        update((s) => ({ ...s, snapshots: [...s.snapshots, { id: uid("snap"), accountId: acc.id, date: sv.date || todayISO(), balanceC: toC(sv.balance) }] }), "snapshot", `Snapshot ${acc.name} = ${sv.balance}`);
                        setSnap({ ...snap, [acc.id]: {} });
                      }}>Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="recon">
                    <div className="muted-s">Reconcile against statement closing balance</div>
                    <div className="recon-row">
                      <input type="date" aria-label={`Statement closing date for ${acc.name}`} value={r.date || ""} onChange={(e) => setRecon({ ...recon, [acc.id]: { ...r, date: e.target.value } })} />
                      <input aria-label={`Statement closing balance for ${acc.name}`} placeholder="Statement balance" value={r.balance || ""} onChange={(e) => setRecon({ ...recon, [acc.id]: { ...r, balance: e.target.value } })} />
                    </div>
                    {diff !== null && (
                      <div className={`recon-result ${diff === 0 ? "ok" : "bad"}`} role="status">
                        {diff === 0 ? "✓ Reconciled — app balance matches the statement." :
                          <>App shows {C(computedAt, cur)} at {r.date}. Difference of <b>{C(diff, cur)}</b> — likely missing or duplicated transactions.</>}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </React.Fragment>
      ))}
      <Card title="Transfers between own accounts" className="span2">
        <p className="muted">Transactions marked <span className="chip transfer">transfer</span> (or categorised as a transfer-kind category, e.g. Credit Card Payment, Investment Contribution) move money between your accounts. They affect individual account balances but are excluded from income, spend, budget variance, forecasting, and the long-term plan — so paying the credit card never double-counts as an expense.</p>
      </Card>
    </div>
  );
}

function Recurring({ state, update, cur, ym, cats }) {
  const totIn = state.recurring.filter((r) => r.amountC > 0).reduce((s, r) => s + r.amountC, 0);
  const totOut = state.recurring.filter((r) => { const c = cats.find((x) => x.id === r.categoryId); return r.amountC < 0 && (!c || c.kind !== "transfer"); }).reduce((s, r) => s + r.amountC, 0);
  return (
    <div className="grid">
      <div className="stat-row">
        <Stat label="Planned monthly income" value={C0(totIn, cur)} tone="pos"
          help="The money-in rows of the table below, added up. This is what you expect in a normal month, not what has actually arrived." />
        <Stat label="Planned monthly expenses" value={C0(totOut, cur)} tone="neg"
          help="The money-out rows of the table below, added up, leaving out anything that only moves money between your own accounts. This is what you expect to spend in a normal month, not what you have actually spent." />
        <Stat label="Planned monthly net" value={C0(totIn + totOut, cur)} tone={totIn + totOut >= 0 ? "pos" : "neg"} sub="a normal month only"
          help="Planned income less planned expenses. Annual and irregular bills are not in here — they sit on the Annual Expenses page and only land in the months they fall due. Money moved between your own accounts is not counted either." />
      </div>
      <Card className="span3" title="Regular monthly income & expenses" right={<span className="muted-s">edits feed the forecast and long-term plan immediately</span>}>
        <TableScroll label="Regular monthly income and expenses">
        <table className="tbl">
          <thead><tr><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Expected day</th><th scope="col" className="r">Amount / month</th>
            <th scope="col">This month ({ymShort(ym)})<Help of="the this-month column" text="What actually went through this month. “actual” means the app found real transactions matching this item, and the figure shown is their total, not the planned amount. “pending” means it has found none yet." /></th>
            <th scope="col" className="r">Variance<Help of="the variance column" text={recurringVarianceHelp(cur)} /></th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {state.recurring.map((r) => {
              const m = matchRecurring(r, state.txns, ym, cats);
              const isTransfer = (cats.find((c) => c.id === r.categoryId) || {}).kind === "transfer";
              return (
                <tr key={r.id}>
                  <td><input className="cell-in" aria-label="Name of this recurring item" value={r.name} onChange={(e) => update((s) => ({ ...s, recurring: s.recurring.map((x) => x.id === r.id ? { ...x, name: e.target.value } : x) }))} /></td>
                  <td>
                    <select className="cat-sel" aria-label={`Category for “${r.name}”`} value={r.categoryId} onChange={(e) => update((s) => ({ ...s, recurring: s.recurring.map((x) => x.id === r.id ? { ...x, categoryId: e.target.value } : x) }), "edit", `Recurring "${r.name}" category changed`)}>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td><input className="cell-in day" aria-label={`Day of the month “${r.name}” is expected`} type="number" min="1" max="31" value={r.day} onChange={(e) => update((s) => ({ ...s, recurring: s.recurring.map((x) => x.id === r.id ? { ...x, day: +e.target.value } : x) }))} /></td>
                  <td className="r"><NumInput label={`Amount per month for “${r.name}”`} valueC={r.amountC} onCommit={(c) => update((s) => ({ ...s, recurring: s.recurring.map((x) => x.id === r.id ? { ...x, amountC: c } : x) }), "edit", `Recurring "${r.name}" amount → ${C(c, cur)}`)} /></td>
                  <td>{isTransfer ? <span className="chip transfer">transfer</span> : m.paid ? <span className="chip ok" title="Matched to real transactions in this month — this is what actually went through, not the planned amount.">actual {C(m.actualC, cur)}</span> : <span className="chip pending">pending</span>}</td>
                  <td className="r">{m.paid && !isTransfer ? <span className={`amt ${m.material ? "warn" : "muted-s"}`} title={recurringVarianceHelp(cur)}>{m.varianceC === 0 ? "on plan" : C(m.varianceC, cur)}{m.material ? " ⚠" : ""}</span> : "—"}</td>
                  <td className="r"><DeleteCell what={r.name} onDelete={() => update((s) => ({ ...s, recurring: s.recurring.filter((x) => x.id !== r.id) }), "edit", `Removed recurring item "${r.name}"`)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </TableScroll>
        <button className="btn ghost" onClick={() => update((s) => ({ ...s, recurring: [...s.recurring, { id: uid("rec"), name: "New item", categoryId: "cat_general", amountC: -10000, day: 1 }] }), "edit", "Added recurring item")}>+ Add recurring item</button>
      </Card>
    </div>
  );
}

function Annual({ state, update, cur, ym, cats, goTxns }) {
  const year = +ym.slice(0, 4);
  const tot = state.annual.reduce((s, a) => s + a.amountC, 0);
  return (
    <div className="grid">
      <div className="stat-row">
        <Stat label={`Annual outgoings · ${year}`} value={C0(tot, cur)} tone="neg" />
        <Stat label="Monthly equivalent" value={C0(Math.round(tot / 12), cur)} sub="worth setting aside each month"
          help="The year's total spread evenly over 12 months. These bills do not actually arrive evenly, so putting this much aside each month is what stops the big ones landing on an empty account." />
        <Stat label="Paid so far this year" value={`${state.annual.filter((a) => matchAnnual(a, state.txns, year).paid).length} / ${state.annual.length}`} />
      </div>
      <Card className="span3" title={`Payment timeline · ${year}`}>
        <div className="timeline">
          {MONTHS.map((m, i) => {
            const items = state.annual.filter((a) => a.month === i + 1);
            const isNow = i + 1 === +nowYm().slice(5) && year === +nowYm().slice(0, 4);
            return (
              <div key={m} className={`tl-month ${isNow ? "now" : ""}`}>
                <div className="tl-label">{m}</div>
                {items.map((a) => {
                  const mm = matchAnnual(a, state.txns, year);
                  return <div key={a.id} className={`tl-item ${mm.paid ? "paid" : ""}`} title={`${a.name} ${C(a.amountC, cur)}`}>{a.name}<br /><b>{C0(a.amountC, cur)}</b></div>;
                })}
              </div>
            );
          })}
        </div>
      </Card>
      <Card className="span3" title="Annual & irregular expenses" right={<span className="muted-s">each amount grows by its annual increase, every year of the forecast</span>}>
        <TableScroll label="Annual and irregular expenses">
        <table className="tbl">
          <thead><tr><th scope="col">Item</th><th scope="col">Category</th><th scope="col">Month</th><th scope="col" className="r">Amount</th>
            <th scope="col">Annual increase %<Help of="the annual increase column" text="How much this bill goes up each year. Applied on top of the amount for every year the forecast and the long-term plan run — 0 keeps it flat." /></th>
            <th scope="col">Status · {year}</th>
            <th scope="col" className="r">Variance<Help of="the variance column" text="The gap between the amount you planned for and what actually went through." /></th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {state.annual.map((a) => {
              const m = matchAnnual(a, state.txns, year);
              return (
                <tr key={a.id}>
                  <td><input className="cell-in" aria-label="Name of this annual item" value={a.name} onChange={(e) => update((s) => ({ ...s, annual: s.annual.map((x) => x.id === a.id ? { ...x, name: e.target.value } : x) }))} /></td>
                  <td><select className="cat-sel" aria-label={`Category for “${a.name}”`} value={a.categoryId} onChange={(e) => update((s) => ({ ...s, annual: s.annual.map((x) => x.id === a.id ? { ...x, categoryId: e.target.value } : x) }))}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                  <td><select className="cat-sel" aria-label={`Month “${a.name}” falls due`} value={a.month} onChange={(e) => update((s) => ({ ...s, annual: s.annual.map((x) => x.id === a.id ? { ...x, month: +e.target.value } : x) }))}>{MONTHS.map((mn, i) => <option key={mn} value={i + 1}>{mn}</option>)}</select></td>
                  <td className="r"><NumInput label={`Amount for “${a.name}”`} valueC={a.amountC} onCommit={(c) => update((s) => ({ ...s, annual: s.annual.map((x) => x.id === a.id ? { ...x, amountC: c } : x) }), "edit", `Annual "${a.name}" amount → ${C(c, cur)}`)} /></td>
                  <td><PctInput label={`Annual increase percent for “${a.name}”`} value={a.escalationPct} onCommit={(v) => update((s) => ({ ...s, annual: s.annual.map((x) => x.id === a.id ? { ...x, escalationPct: v } : x) }))} /></td>
                  <td>{m.paid ? <button className="chip ok click" aria-label={`“${a.name}” paid, ${C(m.actualC, cur)} — show these transactions`} onClick={() => goTxns({ category: a.categoryId })}>paid {C(m.actualC, cur)}</button> : <span className="chip pending">due {MONTHS[a.month - 1]}</span>}</td>
                  <td className="r">{m.paid ? <Amt c={m.varianceC} cur={cur} zero /> : "—"}</td>
                  <td className="r"><DeleteCell what={a.name} onDelete={() => update((s) => ({ ...s, annual: s.annual.filter((x) => x.id !== a.id) }), "edit", `Removed annual item "${a.name}"`)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        </TableScroll>
        <button className="btn ghost" onClick={() => update((s) => ({ ...s, annual: [...s.annual, { id: uid("ann"), name: "New annual item", categoryId: "cat_general", month: 1, amountC: -50000, escalationPct: 5 }] }), "edit", "Added annual item")}>+ Add annual item</button>
      </Card>
    </div>
  );
}

function Compensation({ state, update, cur, palette }) {
  const still = useReducedMotion();
  const { comp, mortgage } = state;
  const setComp = (patch, msg) => update((s) => ({ ...s, comp: { ...s.comp, ...patch } }), "edit", msg);
  const setMort = (patch, msg) => update((s) => ({ ...s, mortgage: { ...s.mortgage, ...patch } }), "edit", msg);
  const am = amortise(mortgage, mortgage.termMonths);
  const payoffYm = am.rows.length ? am.rows[am.rows.length - 1].ym : "—";
  const yearMarks = am.rows.filter((_, i) => i % 12 === 0);
  return (
    <div className="grid">
      <Card title="Compensation">
        <div className="form">
          <label>Monthly salary (net)<NumInput valueC={comp.salaryMonthlyC} onCommit={(c) => setComp({ salaryMonthlyC: c }, `Salary → ${C(c, cur)}`)} /></label>
          <label>Bonus target (% of annual salary)<PctInput value={comp.bonusTargetPct} onCommit={(v) => setComp({ bonusTargetPct: v }, `Bonus target → ${v}%`)} /></label>
          <label>Bonus paid in<select className="cat-sel" aria-label="Month the bonus is paid in" value={comp.bonusMonth} onChange={(e) => setComp({ bonusMonth: +e.target.value }, "Bonus month changed")}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
          <label>Salary growth %/yr<PctInput value={comp.salaryGrowthPct} onCommit={(v) => setComp({ salaryGrowthPct: v }, `Salary growth → ${v}%`)} /></label>
        </div>
        <div className="callout">Annual package at target: <b>{C0(Math.round(comp.salaryMonthlyC * 12 * (1 + comp.bonusTargetPct / 100)), cur)}</b> — flows into the forecast (bonus in {MONTHS[comp.bonusMonth - 1]}) and the long-term plan (growth until retirement).</div>
      </Card>
      <Card title="Mortgage">
        <div className="form">
          <label>Outstanding balance<NumInput valueC={mortgage.balanceC} onCommit={(c) => setMort({ balanceC: c }, `Mortgage balance → ${C(c, cur)}`)} /></label>
          <label>Interest rate %<PctInput value={mortgage.ratePct} onCommit={(v) => setMort({ ratePct: v }, `Mortgage rate → ${v}%`)} step={0.05} /></label>
          <label>Remaining term (months)<PctInput value={mortgage.termMonths} onCommit={(v) => setMort({ termMonths: Math.round(v) }, `Mortgage term → ${v} months`)} step={1} min={1} max={TERM_MONTHS_MAX} validate={termMonthsError} /></label>
          <label>Fixed rate expires<input type="month" className="cell-in" aria-label="Month the fixed rate expires" value={mortgage.fixedExpiry} onChange={(e) => setMort({ fixedExpiry: e.target.value }, "Fixed-rate expiry changed")} /></label>
          <label><span className="l-txt">Monthly payment you actually make (leave 0 to work it out)
            <Help of="the payment you actually make" text="If your lender's payment differs from the textbook figure — because you overpay, or the term was reset — type what you actually pay and the app will use it everywhere. Leave it at 0 and the app works the payment out from the balance, rate and term above." /></span>
            <NumInput label="Monthly mortgage payment you actually make" valueC={mortgage.paymentOverrideC || 0} onCommit={(c) => setMort({ paymentOverrideC: c || null }, `Mortgage payment override → ${C(c, cur)}`)} /></label>
          <label>Property value (estimate)<NumInput valueC={mortgage.propertyValueC || 0} onCommit={(c) => setMort({ propertyValueC: c }, `Property value → ${C(c, cur)}`)} /></label>
        </div>
        <div className="callout">Payment used: <b>{C(am.paymentC, cur)}/mo</b> · projected payoff <b>{payoffYm === "—" ? "—" : ymLabel(payoffYm)}</b> · fixed rate ends <b>{ymLabel(mortgage.fixedExpiry)}</b> — after which the forecast scenario rate change applies.</div>
      </Card>
      <Card className="span2" title="Amortisation — balance & interest vs principal (annual view)">
        <ChartFrame name="Mortgage amortisation by year"
          summary={`For each year until the mortgage is paid off, a stacked bar of the interest and the principal paid that year, and a line of the balance still outstanding. The balance starts at ${C0(mortgage.balanceC, cur)} and the payment used is ${C(am.paymentC, cur)} a month; projected payoff ${payoffYm === "—" ? "not reached" : ymLabel(payoffYm)}.`}>
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={yearMarks.map((r, i) => ({ name: r.ym.slice(0, 4), bal: r.balanceC, int: am.rows.slice(i * 12, i * 12 + 12).reduce((s, x) => s + x.interestC, 0), prin: am.rows.slice(i * 12, i * 12 + 12).reduce((s, x) => s + x.principalC, 0) }))}>
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => C0(v, cur)} tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
            <Tooltip content={chartTip(cur)} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="int" name="Interest / yr" stackId="a" fill={palette.neg} radius={[0, 0, 0, 0]} isAnimationActive={!still} />
            <Bar dataKey="prin" name="Principal / yr" stackId="a" fill={palette.invest} radius={[3, 3, 0, 0]} isAnimationActive={!still} />
            <Line dataKey="bal" name="Balance" stroke={palette.line} strokeWidth={2} dot={false} isAnimationActive={!still} />
          </ComposedChart>
        </ResponsiveContainer>
        </ChartFrame>
      </Card>
    </div>
  );
}

function ScenarioPanel({ state, update }) {
  const sc = state.scenario;
  const st = state.settings;
  const set = (patch) => update((s) => ({ ...s, scenario: { ...s.scenario, ...patch } }));
  return (
    <Card title="Scenario overlay" className="span3 scen" right={
      <label className="switch"><input type="checkbox" checked={sc.enabled} onChange={(e) => set({ enabled: e.target.checked })} /><span>{sc.enabled ? "On — base case preserved" : "Off"}</span></label>
    }>
      {/* The greyed-out look came from opacity and pointer-events, which stop a
          mouse and nothing else: the five fields stayed in the tab order and
          stayed editable from the keyboard. They are really disabled now, so
          what the panel looks like and what it does are the same thing. */}
      <div className="scen-grid" data-off={!sc.enabled}>
        <label>Salary / bonus change %<PctInput disabled={!sc.enabled} value={sc.salaryPct} onCommit={(v) => set({ salaryPct: v })} step={0.5} /></label>
        <label>Spending adjustment %<PctInput disabled={!sc.enabled} value={sc.spendPct} onCommit={(v) => set({ spendPct: v })} step={0.5} /></label>
        {/* These three are added to the rates already in the model, not used in
            place of them — which "delta" never said out loud. */}
        <label>Inflation change %/yr<PctInput disabled={!sc.enabled} value={sc.inflationDelta} onCommit={(v) => set({ inflationDelta: v })} step={0.25} />
          <span className="scen-hint">added to the {st.inflationPct}% in Settings, not instead of it</span></label>
        <label>Mortgage rate change %<PctInput disabled={!sc.enabled} value={sc.rateDelta} onCommit={(v) => set({ rateDelta: v })} step={0.25} />
          <span className="scen-hint">added to the {state.mortgage.ratePct}% on your mortgage</span></label>
        <label>Investment return change %/yr<PctInput disabled={!sc.enabled} value={sc.returnDelta} onCommit={(v) => set({ returnDelta: v })} step={0.25} />
          <span className="scen-hint">added to both the {st.investReturnPct}% investment and {st.cryptoReturnPct}% crypto returns in Settings</span></label>
      </div>
      <div className="muted-s">The overlay is drawn alongside the base case; it never overwrites your model.</div>
    </Card>
  );
}

function Forecast({ state, update, cur, fc, fcScen, palette }) {
  const still = useReducedMotion();
  const chart = fc.rows.map((r, i) => ({ name: ymShort(r.ym), base: r.cum, scen: fcScen ? fcScen.rows[i].cum : undefined }));
  return (
    <div className="grid">
      <ScenarioPanel state={state} update={update} />
      <Card className="span3" title="Cumulative 12-month cashflow">
        <ChartFrame name="Cumulative 12-month cashflow"
          summary={`A line of the running total of monthly net cashflow over the next 12 months${fcScen ? ", with a second dashed line for the scenario overlay" : ""}. Every figure in it is listed month by month in the Monthly detail table below. The base case runs from ${C0(fc.rows[0].cum, cur)} after the first month to ${C0(fc.rows[11].cum, cur)} after the twelfth.`}>
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={chart}>
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => C0(v, cur)} tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
            <Tooltip content={chartTip(cur)} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={0} stroke={palette.zero} />
            <Line dataKey="base" name="Base case" stroke={palette.pos} strokeWidth={2} dot={false} isAnimationActive={!still} />
            {fcScen && <Line dataKey="scen" name="Scenario" stroke={palette.neg} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={!still} />}
          </LineChart>
        </ResponsiveContainer>
        </ChartFrame>
      </Card>
      <Card className="span3" title="Monthly detail" right={<span className="muted-s">a month stops being pure plan as soon as its transactions are matched</span>}>
        {basisLegend}
        <TableScroll label="Monthly detail">
        <table className="tbl">
          <thead><tr><th scope="col">Month</th>
            <th scope="col">Figures are<Help of="the figures-are column" text={`${BASIS_HELP.blend}\n\n${BASIS_HELP.plan}`} /></th>
            <th scope="col" className="r">Income</th><th scope="col" className="r">Outgoings</th><th scope="col" className="r">Net</th>
            <th scope="col" className="r">vs plan<Help of="the vs-plan column" text={forecastVarianceHelp} /></th>
            <th scope="col" className="r">Cumulative</th>{fcScen && <th scope="col" className="r">Scenario net</th>}</tr></thead>
          <tbody>
            {fc.rows.map((r, i) => (
              <tr key={r.ym} className={r.mode !== "plan" ? "hl" : ""}>
                <td>{ymLabel(r.ym)}</td>
                <td><span className={`chip ${r.mode === "plan" ? "ghost" : r.mode === "blend" ? "pending" : "ok"}`} title={BASIS_HELP[r.mode]}>{BASIS_WORD[r.mode] || r.mode}</span></td>
                <td className="r"><Amt c={r.usedIn} cur={cur} /></td>
                <td className="r"><Amt c={r.usedOut} cur={cur} /></td>
                <td className="r"><Amt c={r.net} cur={cur} /></td>
                <td className="r">{r.mode !== "plan" ? <span className={`amt ${Math.abs(r.varianceC) > Math.abs(r.planNet) * 0.1 ? "warn" : "muted-s"}`} title={forecastVarianceHelp}>{C(r.varianceC, cur)}</span> : "—"}</td>
                <td className="r"><Amt c={r.cum} cur={cur} /></td>
                {fcScen && <td className="r"><span className="amt scen-amt">{C(fcScen.rows[i].net, cur)}</span></td>}
              </tr>
            ))}
          </tbody>
        </table>
        </TableScroll>
      </Card>
    </div>
  );
}

function LongTerm({ state, update, cur, lt, ltScen, palette }) {
  const still = useReducedMotion();
  const st = state.settings;
  /* The projection runs from the current age to the planning age, so if the
     planning age is not above the current age there are no years to draw.
     The age fields refuse that combination now, but a model saved before they
     did can still arrive here — say why instead of blanking the screen. */
  if (!lt.rows.length) return (
    <div className="grid">
      <Card className="span3" title="Long-term plan">
        <div className="banner warn">
          There is nothing to project. This plan runs from your current age to your planning age, and your
          planning age ({st.planningAge}) is not above your current age ({st.currentAge}) — so the plan covers
          no years at all. Set a planning age above {st.currentAge} under Settings → Assumptions and this page
          will fill in.
        </div>
      </Card>
    </div>
  );
  const chart = lt.rows.map((r, i) => ({ name: r.age, cash: r.cashC, invest: r.investC, crypto: r.cryptoC, property: r.propertyC, mort: -r.mortC, nw: r.netWorthC, scen: ltScen ? ltScen.rows[i]?.netWorthC : undefined }));
  return (
    <div className="grid">
      <div className="stat-row">
        <Stat label="Planning horizon" value={`age ${st.currentAge} → ${st.planningAge}`} sub={`retiring at ${st.retirementAge}`} />
        <Stat label={`Net worth at ${st.retirementAge}`} value={C0((lt.rows.find((r) => r.age === st.retirementAge) || {}).netWorthC || 0, cur)} tone="pos" />
        <Stat label={`Net worth at ${st.planningAge}`} value={C0(lt.rows[lt.rows.length - 1].netWorthC, cur)} tone={lt.rows[lt.rows.length - 1].netWorthC >= 0 ? "pos" : "neg"} />
        <Stat label="Depletion" value={lt.depletionAge ? `age ${lt.depletionAge}` : "none projected"} tone={lt.depletionAge ? "warn" : "pos"}
          sub={lt.depletionAge ? "assets run out before planning age" : "assets last the full horizon"} />
      </div>
      {lt.depletionAge && <div className="banner warn span3">⚠ Retirement depletion warning: on current assumptions your liquid assets are exhausted at age {lt.depletionAge}, before your planning age of {st.planningAge}. Consider higher contributions, later retirement, or lower spend — test it with the scenario overlay.</div>}
      <ScenarioPanel state={state} update={update} />
      <Card className="span3" title="Assets vs liabilities to planning age" right={<span className="muted-s">starts from your balances today · everything after is projected</span>}>
        <ChartFrame name="Assets and liabilities from now to the planning age"
          summary={`Stacked bands of projected cash, investments, crypto and property, with the mortgage below the line, for every age from ${st.currentAge} to ${st.planningAge}, and a line for net worth${ltScen ? " plus a dashed line for the scenario overlay" : ""}. Every figure in it is listed year by year in the Annual projection table below. Net worth goes from ${C0(lt.rows[0].netWorthC, cur)} at age ${lt.rows[0].age} to ${C0(lt.rows[lt.rows.length - 1].netWorthC, cur)} at age ${lt.rows[lt.rows.length - 1].age}.`}>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chart}>
            <CartesianGrid stroke={palette.grid} vertical={false} />
            <XAxis dataKey="name" tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => C0(v, cur)} tick={{ fill: palette.axis, fontSize: 11 }} axisLine={false} tickLine={false} width={86} />
            <Tooltip content={chartTip(cur)} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine x={st.retirementAge} stroke={palette.marker} strokeDasharray="4 3" />
            <Area dataKey="cash" name="Cash" stackId="a" fill={palette.cash} stroke="none" isAnimationActive={!still} />
            <Area dataKey="invest" name="Investments" stackId="a" fill={palette.invest} stroke="none" isAnimationActive={!still} />
            <Area dataKey="crypto" name="Crypto" stackId="a" fill={palette.crypto} stroke="none" isAnimationActive={!still} />
            <Area dataKey="property" name="Property" stackId="a" fill={palette.property} stroke="none" isAnimationActive={!still} />
            <Area dataKey="mort" name="Mortgage" fill={palette.mortgage} stroke="none" isAnimationActive={!still} />
            <Line dataKey="nw" name="Net worth (base)" stroke={palette.nwLine} strokeWidth={2} dot={false} isAnimationActive={!still} />
            {ltScen && <Line dataKey="scen" name="Net worth (scenario)" stroke={palette.neg} strokeWidth={2} strokeDasharray="6 3" dot={false} isAnimationActive={!still} />}
          </ComposedChart>
        </ResponsiveContainer>
        </ChartFrame>
      </Card>
      <Card className="span3" title="Annual projection" right={
        <label className="muted-s">Planning age <PctInput label="Planning age — the last age the plan draws" value={st.planningAge} step={1} min={AGE_MIN} max={AGE_MAX}
          validate={(v) => ageError("planningAge", v, st)}
          onCommit={(v) => update((s) => ({ ...s, settings: { ...s.settings, planningAge: Math.round(v) } }), "edit", `Planning age → ${v}`)} /></label>
      }>
        <TableScroll label="Annual projection">
          <table className="tbl">
            <thead><tr><th scope="col">Year</th><th scope="col">Age</th><th scope="col"><span className="sr-only">Retired</span></th><th scope="col" className="r">Income</th><th scope="col" className="r">Spend</th><th scope="col" className="r">Net</th><th scope="col" className="r">Cash</th><th scope="col" className="r">Investments</th><th scope="col" className="r">Property</th><th scope="col" className="r">Mortgage</th><th scope="col" className="r">Net worth</th></tr></thead>
            <tbody>
              {lt.rows.map((r) => (
                <tr key={r.age} className={r.age === st.retirementAge ? "hl" : ""}>
                  <td className="mono">{r.year}</td><td className="mono">{r.age}</td>
                  <td>{r.retired ? <span className="chip">retired</span> : ""}</td>
                  <td className="r"><Amt c={r.incomeC} cur={cur} zero /></td>
                  <td className="r"><Amt c={-r.spendC} cur={cur} /></td>
                  <td className="r"><Amt c={r.netC} cur={cur} /></td>
                  <td className="r mono">{C0(r.cashC, cur)}</td>
                  <td className="r mono">{C0(r.investC + r.cryptoC, cur)}</td>
                  <td className="r mono">{r.propertyC ? C0(r.propertyC, cur) : "—"}</td>
                  <td className="r mono">{r.mortC > 0 ? C0(-r.mortC, cur) : "—"}</td>
                  <td className="r"><b><Amt c={r.netWorthC} cur={cur} /></b></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  );
}

/* ============================================================
   IMPORTS — upload → map columns → stage → review → commit
   ============================================================ */
/* applyRules writes a raw token; these are the words shown for it. */
const CONFIDENCE = {
  high:   { word: "rule matched",   help: "One of your merchant rules matched this description, so the category is near enough certain." },
  medium: { word: "guessed",        help: "No rule matched, but a category name appears in the description, so it was guessed. Worth a glance." },
  low:    { word: "not recognised", help: "Nothing matched, so it was left uncategorised. Pick a category here, or add a rule so next month's import lands clean." },
  manual: { word: "you chose it",   help: "You picked this category by hand on this screen." },
};

function Imports({ state, update, cur, cats, catName, accName }) {
  const [step, setStep] = useState("upload"); // upload | map | review
  const [file, setFile] = useState(null);
  const [raw, setRaw] = useState(null); // {headers, rows} or {ofx:[...]}
  const firstAccount = state.accounts[0];
  const [map, setMap] = useState({ date: "", desc: "", amount: "", debit: "", credit: "", invert: false, accountId: firstAccount ? firstAccount.id : "", mode: "single" });
  const [staged, setStaged] = useState([]);
  const [err, setErr] = useState("");
  const fileRef = useRef();
  // imported transactions have to land in an account, and this model holds none
  const noAccounts = !firstAccount;

  const applyRules = (desc) => {
    const U = desc.toUpperCase();
    const rule = state.rules.find((r) => U.includes(r.pattern.toUpperCase()));
    if (rule) return { categoryId: rule.categoryId, confidence: "high", ruleId: rule.id };
    // fuzzy: category name appears in description
    const fuzzy = cats.find((c) => c.id !== "cat_uncat" && U.includes(c.name.toUpperCase()));
    if (fuzzy) return { categoryId: fuzzy.id, confidence: "medium", ruleId: null };
    return { categoryId: "cat_uncat", confidence: "low", ruleId: null };
  };

  const isDup = (t) => state.txns.some((x) => x.accountId === t.accountId && x.date === t.date && x.amountC === t.amountC &&
    x.desc.toUpperCase().slice(0, 12) === t.desc.toUpperCase().slice(0, 12));

  const stageRows = (rows) => {
    const s = rows.map((r) => {
      const cat = applyRules(r.desc);
      const rec = { id: uid("stg"), include: true, ...r, ...cat };
      rec.dup = isDup(rec);
      if (rec.dup) rec.include = false;
      return rec;
    });
    setStaged(s);
    setStep("review");
  };

  const handleFile = async (f) => {
    setErr(""); setFile(f);
    const ext = f.name.split(".").pop().toLowerCase();
    try {
      if (ext === "csv" || ext === "txt") {
        const text = await f.text();
        const p = Papa.parse(text, { header: true, skipEmptyLines: true });
        if (!p.data.length) throw new Error("No rows found in the CSV.");
        setRaw({ headers: p.meta.fields, rows: p.data });
        autoMap(p.meta.fields);
        setStep("map");
      } else if (ext === "xlsx" || ext === "xls") {
        const buf = await f.arrayBuffer();
        const wb = XLSX.read(buf);
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
        if (!json.length) throw new Error("No rows found in the first sheet.");
        const headers = Object.keys(json[0]);
        setRaw({ headers, rows: json });
        autoMap(headers);
        setStep("map");
      } else if (ext === "ofx" || ext === "qfx") {
        const text = await f.text();
        const txns = parseOFX(text);
        if (!txns.length) throw new Error("No <STMTTRN> blocks found in the OFX/QFX file.");
        stageRows(txns.map((t) => ({ ...t, accountId: map.accountId })));
      } else if (ext === "pdf") {
        setErr("PDF import is experimental and not available in this prototype build — reliable extraction needs a server-side parser (planned: pdfplumber + layout heuristics on the backend). Export CSV/XLSX from your bank instead; every major bank offers it alongside PDF.");
      } else {
        setErr(`Unsupported file type ".${ext}". Accepted: CSV, XLSX, OFX/QFX — and PDF as a clearly experimental option.`);
      }
    } catch (e) { setErr(e.message || "Could not read the file."); }
  };

  const autoMap = (headers) => {
    const find = (...keys) => headers.find((h) => keys.some((k) => h.toLowerCase().includes(k))) || "";
    const debit = find("debit", "withdrawal", "money out");
    const credit = find("credit", "deposit", "money in");
    setMap((m) => ({
      ...m,
      date: find("date", "posted"),
      desc: find("desc", "narrat", "detail", "merchant", "reference", "payee", "name"),
      amount: find("amount", "value"),
      debit, credit,
      mode: debit && credit && !find("amount") ? "split" : "single",
    }));
  };

  const runMapping = () => {
    setErr("");
    const rows = [];
    let bad = 0;
    raw.rows.forEach((r) => {
      const date = parseDateAny(r[map.date], state.settings.dayFirstDates);
      const desc = String(r[map.desc] ?? "").trim() || "(no description)";
      let amountC;
      if (map.mode === "split") {
        const d = toC(r[map.debit]), c = toC(r[map.credit]);
        amountC = c - Math.abs(d);
      } else {
        amountC = toC(r[map.amount]);
        if (map.invert) amountC = -amountC;
      }
      if (!date || amountC === 0) { bad++; return; }
      rows.push({ date, desc, amountC, accountId: map.accountId });
    });
    if (!rows.length) { setErr("No valid rows after mapping — check the date and amount columns."); return; }
    if (bad) setErr(`${bad} row(s) skipped (unparseable date or zero amount).`);
    stageRows(rows);
  };

  const setStg = (id, patch) => setStaged((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));

  const commit = () => {
    const inc = staged.filter((s) => s.include);
    const batchId = uid("batch");
    update((s) => ({
      ...s,
      txns: [...s.txns, ...inc.map((t) => ({ id: uid("txn"), accountId: t.accountId, date: t.date, desc: t.desc, amountC: t.amountC, categoryId: t.categoryId, source: "import", batchId }))],
      batches: [{ id: batchId, filename: file ? file.name : "upload", when: new Date().toISOString().slice(0, 16).replace("T", " "), count: inc.length, accountIds: [map.accountId] }, ...s.batches],
    }), "import", `Committed ${inc.length} transactions from "${file ? file.name : "upload"}" (${staged.length - inc.length} skipped)`);
    setStep("upload"); setStaged([]); setRaw(null); setFile(null); setErr("");
  };

  const stats = {
    inc: staged.filter((s) => s.include).length,
    dup: staged.filter((s) => s.dup).length,
    low: staged.filter((s) => s.confidence === "low").length,
  };

  return (
    <div className="grid">
      {/* Which step you were on, and which you had finished, was drawn only in
          colour: a green border for now, a paler grey for done. Both are the
          same grey to anyone who cannot separate them, and the same grey in
          print. Every step now says its own number, its own total and its own
          state in words. */}
      <div className="steps span3">
        {["upload", "map", "review"].map((s, i) => {
          const done = ["upload", "map", "review"].indexOf(step) > i;
          const here = step === s;
          return (
            <div key={s} className={`step ${here ? "on" : ""} ${done ? "done" : ""}`} aria-current={here ? "step" : undefined}>
              <span className="step-n" aria-hidden="true">{done ? "✓" : i + 1}</span>
              <span className="step-txt">
                <span className="step-of">Step {i + 1} of 3 — {done ? "done" : here ? "you are here" : "not started"}</span>
                {s === "upload" ? "Upload statement" : s === "map" ? "Map columns" : "Review & commit"}
              </span>
            </div>
          );
        })}
      </div>

      {step === "upload" && (
        <>
          <Card className="span2" title="Upload a statement export">
            {noAccounts && <div className="banner warn">This model has no accounts, so there is nowhere for imported transactions to land. Importing is switched off until it has one.</div>}
            {/* Importing a statement is how data gets into this app, and there
                was no keyboard route to it at all: a <div onClick> over an
                <input type="file" hidden>, neither of which a Tab key can
                reach. The drop zone is a real button now — Tab to it, press
                Enter or Space, and the file picker opens. Drag-and-drop still
                works on it. The input keeps the file, but is only ever driven
                by that button, so it is out of the tab order and out of the
                accessibility tree rather than being a second, silent stop. */}
            <button type="button" className={`drop ${noAccounts ? "off" : ""}`} disabled={noAccounts}
              onClick={() => fileRef.current.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (!noAccounts && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}>
              <span className="drop-ic" aria-hidden="true">⇪</span>
              <span>Drop a bank / credit-card / investment export here, or press to choose a file</span>
              <span className="muted-s">CSV · XLSX · OFX/QFX &nbsp;·&nbsp; <span className="chip warn">PDF — experimental</span></span>
            </button>
            <input ref={fileRef} type="file" className="file-proxy" tabIndex={-1} aria-hidden="true"
              accept=".csv,.xlsx,.xls,.ofx,.qfx,.pdf,.txt" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
            <div className="form" style={{ marginTop: 12 }}>
              <label>Import into account
                <select className="cat-sel" aria-label="Account the imported transactions land in" value={map.accountId} disabled={noAccounts} onChange={(e) => setMap({ ...map, accountId: e.target.value })}>
                  {noAccounts ? <option value="">No accounts</option> : state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            </div>
            {err && <div className="banner warn" role="alert">{err}</div>}
            <p className="muted">No bank connections, no stored credentials — you stay in control of what enters the model. Nothing is saved until you commit on the review screen.</p>
          </Card>
          <Card title="Merchant rules" right={<span className="muted-s">drive auto-categorisation</span>}>
            <TableScroll label="Merchant rules" maxHeight={260}>
              <table className="tbl">
                <thead><tr><th scope="col">If description contains</th><th scope="col">Categorise as</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {state.rules.map((r) => (
                    <tr key={r.id}>
                      <td><input className="cell-in mono" aria-label="Text this rule looks for in a description" value={r.pattern} onChange={(e) => update((s) => ({ ...s, rules: s.rules.map((x) => x.id === r.id ? { ...x, pattern: e.target.value } : x) }))} /></td>
                      <td><select className="cat-sel" aria-label={`Category for descriptions containing “${r.pattern}”`} value={r.categoryId} onChange={(e) => update((s) => ({ ...s, rules: s.rules.map((x) => x.id === r.id ? { ...x, categoryId: e.target.value } : x) }), "rule", `Rule "${r.pattern}" → ${catName(e.target.value)}`)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                      <td><DeleteCell what={r.pattern} onDelete={() => update((s) => ({ ...s, rules: s.rules.filter((x) => x.id !== r.id) }), "rule", `Deleted rule "${r.pattern}"`)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <button className="btn ghost" onClick={() => update((s) => ({ ...s, rules: [{ id: uid("rule"), pattern: "NEW PATTERN", categoryId: "cat_general" }, ...s.rules] }), "rule", "Added merchant rule")}>+ Add rule</button>
          </Card>
          <Card className="span3" title="Import history">
            <TableScroll label="Import history">
            <table className="tbl">
              <thead><tr><th scope="col">When</th><th scope="col">File</th><th scope="col" className="r">Transactions</th><th scope="col">Accounts</th></tr></thead>
              <tbody>
                {state.batches.map((b) => (
                  <tr key={b.id}><td className="mono">{b.when}</td><td>{b.filename}</td><td className="r mono">{b.count}</td><td className="muted-s">{b.accountIds.map(accName).join(", ")}</td></tr>
                ))}
              </tbody>
            </table>
            </TableScroll>
          </Card>
        </>
      )}

      {step === "map" && raw && (
        <Card className="span3" title={`Map columns — ${file.name}`} right={<span className="muted-s">{raw.rows.length} rows detected</span>}>
          <div className="form form-row">
            <label>Date column<select className="cat-sel" value={map.date} onChange={(e) => setMap({ ...map, date: e.target.value })}><option value="">—</option>{raw.headers.map((h) => <option key={h}>{h}</option>)}</select></label>
            <label>Description column<select className="cat-sel" value={map.desc} onChange={(e) => setMap({ ...map, desc: e.target.value })}><option value="">—</option>{raw.headers.map((h) => <option key={h}>{h}</option>)}</select></label>
            {/* Option text has to stay inside .cat-sel's 175px, so the fuller
                wording lives on the label rather than clipping in the box. */}
            <label><span className="l-txt">Amount layout<Help of="the amount layout" text="How your export writes amounts: one column where money out is a minus, or two columns — one for money out, one for money in." /></span>
              <select className="cat-sel" aria-label="Amount layout in your export" value={map.mode} onChange={(e) => setMap({ ...map, mode: e.target.value })}>
                <option value="single">One amount column</option>
                <option value="split">Separate debit / credit columns</option>
              </select>
            </label>
            {map.mode === "single" ? (
              <>
                <label>Amount column<select className="cat-sel" value={map.amount} onChange={(e) => setMap({ ...map, amount: e.target.value })}><option value="">—</option>{raw.headers.map((h) => <option key={h}>{h}</option>)}</select></label>
                <label className="chk"><input type="checkbox" checked={map.invert} onChange={(e) => setMap({ ...map, invert: e.target.checked })} /> Invert sign (credit-card exports that show spend as positive)</label>
              </>
            ) : (
              <>
                <label>Debit (money out)<select className="cat-sel" value={map.debit} onChange={(e) => setMap({ ...map, debit: e.target.value })}><option value="">—</option>{raw.headers.map((h) => <option key={h}>{h}</option>)}</select></label>
                <label>Credit (money in)<select className="cat-sel" value={map.credit} onChange={(e) => setMap({ ...map, credit: e.target.value })}><option value="">—</option>{raw.headers.map((h) => <option key={h}>{h}</option>)}</select></label>
              </>
            )}
          </div>
          <div className="muted-s" style={{ margin: "10px 0 4px" }}>Preview (first 5 rows as they will be interpreted)</div>
          <TableScroll label="Preview of the first five rows">
          <table className="tbl">
            <thead><tr><th scope="col">Date</th><th scope="col">Description</th><th scope="col" className="r">Amount</th></tr></thead>
            <tbody>
              {raw.rows.slice(0, 5).map((r, i) => {
                const date = parseDateAny(r[map.date], state.settings.dayFirstDates);
                let amt = map.mode === "split" ? toC(r[map.credit]) - Math.abs(toC(r[map.debit])) : toC(r[map.amount]) * (map.invert ? -1 : 1);
                return <tr key={i}><td className="mono">{date || <span className="warn-t">unreadable</span>}</td><td>{String(r[map.desc] ?? "")}</td><td className="r"><Amt c={amt} cur={cur} /></td></tr>;
              })}
            </tbody>
          </table>
          </TableScroll>
          {err && <div className="banner warn" role="alert">{err}</div>}
          <div className="actions">
            <button className="btn ghost" onClick={() => { setStep("upload"); setErr(""); }}>← Back</button>
            <button className="btn" disabled={!map.date || (map.mode === "single" ? !map.amount : !map.debit && !map.credit)} onClick={runMapping}>Stage {raw.rows.length} rows →</button>
          </div>
        </Card>
      )}

      {step === "review" && (
        <Card className="span3" title="Review staged transactions" right={
          <span className="muted-s">{stats.inc} to commit · <span className="warn-t">{stats.dup} likely duplicates</span> · <span className="warn-t">{stats.low} not recognised</span></span>
        }>
          {/* set by runMapping when rows failed to map — it used to be written
              and then immediately stepped past, so nobody ever saw it */}
          {err && <div className="banner warn" role="alert">{err}</div>}
          <div className="banner">Nothing has been saved yet. Duplicates were auto-deselected; anything the app could not categorise is flagged <span className="chip warn">{CONFIDENCE.low.word}</span> — fix them here or add a merchant rule so next month's import lands clean.</div>
          <TableScroll label="Staged transactions" maxHeight={420}>
            <table className="tbl">
              <thead><tr><th scope="col"><span className="sr-only">Import this row</span></th><th scope="col">Date</th><th scope="col">Description</th><th scope="col" className="r">Amount</th><th scope="col">Category</th>
                <th scope="col">Where the category came from<Help of="where the category came from" text={`How the app arrived at the category on the left, and therefore how much it is worth checking. “${CONFIDENCE.high.word}”: ${CONFIDENCE.high.help} “${CONFIDENCE.medium.word}”: ${CONFIDENCE.medium.help} “${CONFIDENCE.low.word}”: ${CONFIDENCE.low.help} “${CONFIDENCE.manual.word}”: ${CONFIDENCE.manual.help}`} /></th>
                <th scope="col">Flags</th><th scope="col">Rule</th></tr></thead>
              <tbody>
                {staged.map((t) => (
                  <tr key={t.id} className={!t.include ? "dim" : ""}>
                    <td><input type="checkbox" aria-label={`Import “${t.desc}” of ${C(t.amountC, cur)} on ${t.date}`} checked={t.include} onChange={(e) => setStg(t.id, { include: e.target.checked })} /></td>
                    <td className="mono">{t.date}</td>
                    <td>{t.desc}</td>
                    <td className="r"><Amt c={t.amountC} cur={cur} /></td>
                    <td><select className="cat-sel" aria-label={`Category for “${t.desc}”`} value={t.categoryId} onChange={(e) => setStg(t.id, { categoryId: e.target.value, confidence: "manual" })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                    <td><span className={`chip ${t.confidence === "high" ? "ok" : t.confidence === "medium" ? "pending" : t.confidence === "manual" ? "ghost" : "warn"}`}
                      title={(CONFIDENCE[t.confidence] || {}).help}>{(CONFIDENCE[t.confidence] || {}).word || t.confidence}</span></td>
                    {/* A deselected row was marked by nothing but a drop in
                        opacity, which says nothing to anyone who cannot see it
                        and left the row's own text at about 3:1. Say it. */}
                    <td>{t.dup && <span className="chip warn">duplicate?</span>}{!t.include && <span className="chip">not importing</span>}</td>
                    <td>{t.confidence !== "high" && (
                      <button className="mini" title="Create a merchant rule from this description"
                        aria-label={`Create a merchant rule from “${t.desc}”`} onClick={() => {
                        const pattern = t.desc.toUpperCase().split(/\s+/).slice(0, 2).join(" ");
                        update((s) => ({ ...s, rules: [{ id: uid("rule"), pattern, categoryId: t.categoryId }, ...s.rules] }), "rule", `Rule from import: "${pattern}" → ${catName(t.categoryId)}`);
                        setStaged((s) => s.map((x) => x.desc.toUpperCase().includes(pattern) ? { ...x, categoryId: t.categoryId, confidence: "high" } : x));
                      }}>+rule</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <div className="actions">
            <button className="btn ghost" onClick={() => { setErr(""); setStep(raw ? "map" : "upload"); }}>← Back</button>
            <button className="btn" disabled={!stats.inc} onClick={commit}>Commit {stats.inc} transactions</button>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ============================================================
   SETTINGS · EXPORT · AUDIT TRAIL
   ============================================================ */
function Settings({ state, update, cur, fc, lt, catName, accName, theme, setTheme }) {
  const st = state.settings;
  const set = (patch, msg) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }), "edit", msg);
  return (
    <div className="grid">
      <Card title="Assumptions">
        <div className="form">
          <label>Currency symbol<input className="cell-in" aria-label="Currency symbol" style={{ width: 60 }} value={st.currency} onChange={(e) => set({ currency: e.target.value })} /></label>
          <label>Current age<PctInput value={st.currentAge} step={1} min={AGE_MIN} max={AGE_MAX}
            validate={(v) => ageError("currentAge", v, st)} onCommit={(v) => set({ currentAge: Math.round(v) }, `Current age → ${v}`)} /></label>
          {/* A retirement age below the current age is a valid answer — it means
              already retired — so it is bounded only by the absolute age range. */}
          <label>Retirement age<PctInput value={st.retirementAge} step={1} min={AGE_MIN} max={AGE_MAX}
            validate={(v) => ageError("retirementAge", v, st)} onCommit={(v) => set({ retirementAge: Math.round(v) }, `Retirement age → ${v}`)} /></label>
          <label><span className="l-txt">Plan runs to age<Help of="the age the plan runs to" text="How far ahead the Long-Term Plan runs — the last age it draws. It is a planning horizon, not a guess at how long you will live." /></span>
            <PctInput label="Plan runs to age" value={st.planningAge} step={1} min={AGE_MIN} max={AGE_MAX}
            validate={(v) => ageError("planningAge", v, st)} onCommit={(v) => set({ planningAge: Math.round(v) }, `Planning age → ${v}`)} /></label>
          <label>Inflation %/yr<PctInput value={st.inflationPct} onCommit={(v) => set({ inflationPct: v }, `Inflation → ${v}%`)} /></label>
          <label>Investment return %/yr<PctInput value={st.investReturnPct} onCommit={(v) => set({ investReturnPct: v }, `Investment return → ${v}%`)} /></label>
          <label>Crypto return %/yr<PctInput value={st.cryptoReturnPct} onCommit={(v) => set({ cryptoReturnPct: v }, `Crypto return → ${v}%`)} /></label>
          <label>Cash return %/yr<PctInput value={st.cashReturnPct} onCommit={(v) => set({ cashReturnPct: v }, `Cash return → ${v}%`)} /></label>
          <label className="chk"><input type="checkbox" checked={st.dayFirstDates} onChange={(e) => set({ dayFirstDates: e.target.checked })} /> Statement dates are day-first (dd/mm/yyyy)</label>
          <label className="chk"><input type="checkbox" checked={theme === "light"} onChange={(e) => setTheme(e.target.checked ? "light" : "dark")} /> Light theme</label>
        </div>
      </Card>
      <Card title="Export">
        <p className="muted">Everything the model holds, out as CSV — open in Excel to cross-check against your old spreadsheet.</p>
        <div className="btn-col">
          <button className="btn" onClick={() => downloadCSV("transactions.csv",
            ["date", "account", "description", "category", "amount", "transfer", "excluded", "source"],
            state.txns.map((t) => [t.date, accName(t.accountId), t.desc, catName(t.categoryId), (t.amountC / 100).toFixed(2), t.transfer ? "yes" : "", t.excluded ? "yes" : "", t.source]))}>
            ⇩ Transactions</button>
          <button className="btn" onClick={() => downloadCSV("forecast_12m.csv",
            ["month", "basis", "income", "outgoings", "net", "cumulative", "variance_vs_plan"],
            fc.rows.map((r) => [r.ym, r.mode, (r.usedIn / 100).toFixed(2), (r.usedOut / 100).toFixed(2), (r.net / 100).toFixed(2), (r.cum / 100).toFixed(2), (r.varianceC / 100).toFixed(2)]))}>
            ⇩ 12-month forecast</button>
          <button className="btn" onClick={() => downloadCSV("long_term_plan.csv",
            ["year", "age", "retired", "income", "spend", "net", "cash", "investments", "crypto", "property", "mortgage", "net_worth"],
            lt.rows.map((r) => [r.year, r.age, r.retired ? "yes" : "", (r.incomeC / 100).toFixed(2), (r.spendC / 100).toFixed(2), (r.netC / 100).toFixed(2), (r.cashC / 100).toFixed(2), (r.investC / 100).toFixed(2), (r.cryptoC / 100).toFixed(2), ((r.propertyC || 0) / 100).toFixed(2), (r.mortC / 100).toFixed(2), (r.netWorthC / 100).toFixed(2)]))}>
            ⇩ Long-term plan</button>
        </div>
        <p className="muted-s" style={{ marginTop: 10 }}>When you are signed in, every change is saved to your account on its own, and nobody else can read it. In demo mode nothing is saved — close the tab and the figures are gone, so export anything you want to keep.</p>
      </Card>
      <Card className="span3" title="Audit trail" right={<span className="muted-s">{state.audit.length} events — every import, edit, exclusion and rule change</span>}>
        <TableScroll label="Audit trail" maxHeight={340}>
          <table className="tbl">
            <thead><tr><th scope="col">When</th><th scope="col">Type</th><th scope="col">Detail</th></tr></thead>
            <tbody>
              {state.audit.map((a) => (
                <tr key={a.id}><td className="mono">{a.when}</td><td><span className={`chip ${a.kind === "import" ? "ok" : a.kind === "rule" ? "pending" : "ghost"}`}>{a.kind}</span></td><td>{a.detail}</td></tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Card>
    </div>
  );
}

/* ============================================================
   DESIGN SYSTEM — dark ledger: deep evergreen graphite,
   restrained mint accent, amber for variance, mono figures.
   ============================================================ */
const CSS = `
  * { box-sizing: border-box; margin: 0; }
  /* Every size in this stylesheet was px, so a reader who raises the browser's
     default text size got nothing at all — the app ignored the setting
     outright. The type scale is in rem now and follows that default. The scale
     itself is not redrawn: 0.875rem is the 14px this has always been at a 16px
     default, and so on down. Widths, padding and the sidebar stay in px on
     purpose; making the layout itself elastic is a separate job. */
  .app { display: flex; min-height: 100vh; background: var(--bg); color: var(--text);
    font: 0.875rem/1.45 -apple-system, "Segoe UI", Inter, Roboto, sans-serif; }

  /* Text for assistive technology only: still in the accessibility tree, still
     read out, takes no space and paints nothing. */
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; border: 0; }

  /* Nothing in this app said where the keyboard was: inputs and selects had
     their focus ring removed outright, and no rule ever put one back. One
     treatment for everything, drawn in the accent already in the palette so it
     reads against both themes. :focus-visible, so a mouse click does not leave
     a ring behind on something that was only pressed. */
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .mono, .amt, .num-in, .stat-value, .acc-bal, td.mono, .tl-item b { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }

  /* nav */
  .nav { width: 216px; flex: none; background: var(--surface-nav); border-right: 1px solid var(--border-soft); padding: 18px 10px; display: flex; flex-direction: column; gap: 2px; position: sticky; top: 0; height: 100vh; }
  .brand { display: flex; gap: 10px; align-items: center; padding: 4px 8px 18px; }
  .brand-mark { width: 34px; height: 34px; border-radius: 8px; background: linear-gradient(135deg, var(--brand-grad-from), var(--accent-deep)); display: grid; place-items: center; color: var(--brand-mark-text); font-size: 1.0625rem; }
  .brand-name { font-weight: 700; letter-spacing: .18em; font-size: 0.75rem; color: var(--text-strong); }
  .brand-sub { font-size: 0.625rem; color: var(--text-muted); letter-spacing: .04em; }
  .nav-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: 7px; background: transparent; color: var(--text-nav); font-size: 0.8125rem; cursor: pointer; }
  .nav-item:hover { background: var(--surface-hover-nav); color: var(--text); }
  .nav-item.on { background: var(--surface-active-nav); color: var(--accent); box-shadow: inset 2px 0 0 var(--accent-strong); }
  .nav-ic { width: 16px; text-align: center; opacity: .8; }
  .nav-badge { margin-left: auto; background: var(--accent-bg-badge); color: var(--accent); border-radius: 9px; font-size: 0.625rem; padding: 1px 7px; }
  .nav-foot { margin-top: auto; font-size: 0.625rem; color: var(--text-faint); padding: 10px 8px 0; line-height: 1.6; border-top: 1px solid var(--border-soft); }

  /* layout */
  .main { flex: 1; padding: 0 26px 40px; min-width: 0; }
  .topbar { display: flex; align-items: center; gap: 18px; padding: 16px 0 14px; border-bottom: 1px solid var(--border-soft); margin-bottom: 18px; position: sticky; top: 0; background: var(--bg-translucent); backdrop-filter: blur(4px); z-index: 5; }
  .crumb { font-size: 1.0625rem; font-weight: 600; color: var(--text-strong); line-height: 1.45; }
  .month-sel { display: flex; align-items: center; gap: 4px; background: var(--surface-raised); border: 1px solid var(--border-strong); border-radius: 8px; padding: 3px 6px; }
  .month-sel span { min-width: 76px; text-align: center; font-size: 0.8125rem; color: var(--accent-text-2); }
  .month-sel button { background: none; border: 0; color: var(--accent); cursor: pointer; font-size: 0.9375rem; padding: 2px 8px; border-radius: 5px; }
  .month-sel button:hover { background: var(--surface-hover-strong); }
  .month-sel .today { font-size: 0.6875rem; color: var(--neg); }
  .scen-pill { margin-left: auto; font-size: 0.625rem; letter-spacing: .14em; padding: 4px 10px; border-radius: 20px; border: 1px solid var(--border-strong); color: var(--text-muted); display: flex; align-items: center; }
  .scen-pill[data-on="true"] { border-color: var(--neg-border); color: var(--neg); background: var(--neg-bg); }

  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .span2 { grid-column: span 2; } .span3 { grid-column: span 3; }
  .stat-row { grid-column: span 3; display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; }

  .card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; min-width: 0; }
  .card-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; }
  .card-head h2 { font-size: 0.75rem; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted-2); }
  .acc-type { font-size: 0.5625rem; letter-spacing: .12em; color: var(--accent-strong); margin-right: 8px; text-transform: uppercase; background: var(--accent-bg-chip); padding: 2px 7px; border-radius: 4px; }

  .stat { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; position: relative; }
  .stat.click:hover { border-color: var(--accent-deep); }
  /* The clickable tiles are buttons now; strip the button chrome so they draw
     exactly as the plain tiles beside them do. */
  .stat-hit { display: block; width: 100%; text-align: left; background: none; border: 0; padding: 0;
    color: inherit; font: inherit; }
  .stat.click .stat-hit { cursor: pointer; }
  .stat > .help-wrap { position: absolute; top: 12px; right: 13px; }
  .stat-label { display: block; font-size: 0.625rem; letter-spacing: .12em; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px; padding-right: 14px; }
  .stat-value { display: block; font-size: 1.3125rem; font-weight: 600; color: var(--text-strong); }
  .stat-value.pos { color: var(--pos); } .stat-value.neg { color: var(--neg); } .stat-value.warn { color: var(--warn); }
  .stat-sub { display: block; font-size: 0.6875rem; color: var(--text-muted); margin-top: 4px; }

  .amt.pos { color: var(--pos); } .amt.neg { color: var(--neg); } .amt.warn { color: var(--warn); font-weight: 600; }
  .amt.muted-s { color: var(--text-muted); } .scen-amt { color: var(--neg); }
  .warn-t { color: var(--warn); }
  .muted { color: var(--text-muted-2); font-size: 0.8125rem; } .muted-s { color: var(--text-muted); font-size: 0.71875rem; }
  .empty { color: var(--text-muted); font-size: 0.8125rem; padding: 14px 4px; }
  .acc-bal { font-size: 1.5rem; font-weight: 600; color: var(--text-strong); margin-bottom: 4px; }

  /* tables */
  .tbl { width: 100%; border-collapse: collapse; font-size: 0.8125rem; }
  .tbl th { text-align: left; font-size: 0.625rem; letter-spacing: .1em; text-transform: uppercase; color: var(--text-muted); padding: 6px 8px; border-bottom: 1px solid var(--border); font-weight: 600; }
  .tbl td { padding: 6px 8px; border-bottom: 1px solid var(--border-subtle); vertical-align: middle; }
  .tbl tr:hover td { background: var(--surface-hover); }
  .tbl .r, th.r { text-align: right; }
  /* Excluded transactions, and import rows you have deselected, were marked by
     nothing but opacity: .38 — no signal at all if you cannot see it, and it
     drove the row's own text down to about 3.0:1 in dark and 2.3:1 in light.
     Both tables now say it in the Flags column; the row is de-emphasised by
     dropping to the muted colour and leaning it over, neither of which takes
     it below the contrast floor. */
  .tbl tr.dim td, .tbl tr.dim td .amt, .tbl tr.dim td .muted-s { color: var(--text-muted); font-style: italic; }
  .tbl tr.hl td { background: var(--row-hl); }
  /* Set by TableScroll: "on" while the table is wider than the card, "capped"
     where the card also limits the height. Kept off until it is needed so a
     table that fits is never a clipping box for the explanation panels that
     hang out of its header cells. */
  .tbl-wrap { min-width: 0; }
  /* position, so the absolutely-positioned .sr-only labels inside the header
     cells resolve against this box. Left to resolve against the page they
     escape the clipping — each one sitting at the far right of a table 700px
     wide inside a 221px card — and the document grows to hold them, which is
     the very horizontal scrollbar this container exists to prevent. Scoped to
     the scrolling state: position: relative gives the box its own paint layer,
     which changes how the text inside it is antialiased, and a table that fits
     should render exactly as it always has. */
  .tbl-wrap.on { overflow-x: auto; position: relative; }
  .tbl-wrap.capped { overflow-y: auto; position: relative; }
  /* The focus ring of a scrollable region is drawn inside it, or the outline
     is the thing that overflows the card. */
  .tbl-wrap:focus-visible { outline-offset: -2px; }

  .chip { display: inline-block; font-size: 0.625rem; padding: 2px 8px; border-radius: 10px; background: var(--chip-bg); color: var(--text-muted-2); border: 1px solid var(--border-strong); letter-spacing: .03em; white-space: nowrap; }
  .chip.ok { background: var(--accent-bg); color: var(--accent); border-color: var(--accent-border); }
  .chip.pending { background: var(--pending-bg); color: var(--pending); border-color: var(--pending-border); }
  .chip.warn { background: var(--warn-bg); color: var(--warn); border-color: var(--warn-border); }
  .chip.transfer { background: var(--transfer-bg); color: var(--transfer); border-color: var(--transfer-border); }
  .chip.ghost { background: transparent; }
  .chip.click { cursor: pointer; }

  /* inputs */
  input, select { background: var(--surface-sunken); border: 1px solid var(--border-strong); color: var(--text); border-radius: 6px; padding: 5px 8px; font: inherit; }
  input:focus, select:focus { border-color: var(--accent-deep); }
  input:disabled, select:disabled { cursor: default; }
  .cat-sel { max-width: 175px; font-size: 0.75rem; }
  .cell-in { width: 100%; max-width: 170px; background: transparent; border-color: transparent; }
  .cell-in:hover, .cell-in:focus { border-color: var(--border-strong); background: var(--surface-sunken); }
  .cell-in.day { width: 54px; }
  .num-in { width: 110px; text-align: right; }
  .num-in.pct { width: 74px; }
  input.invalid, input.invalid:focus { border-color: var(--neg); }
  .in-wrap { display: inline-flex; flex-direction: column; gap: 3px; align-items: flex-end; }
  .in-err { font-size: 0.6875rem; line-height: 1.3; color: var(--neg); max-width: 220px; text-align: right; }
  .form .in-wrap, .add-row .in-wrap { align-items: flex-start; }
  .form .in-err, .add-row .in-err { text-align: left; }
  .filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .filters input { width: 170px; }
  .form { display: flex; flex-direction: column; gap: 10px; }
  .form.form-row { flex-direction: row; flex-wrap: wrap; gap: 16px; }
  .form label { display: flex; flex-direction: column; gap: 4px; font-size: 0.6875rem; color: var(--text-muted-2); letter-spacing: .04em; }
  .form label.chk, .switch { flex-direction: row; align-items: center; gap: 8px; font-size: 0.75rem; color: var(--text-soft); cursor: pointer; display: flex; }
  .add-row { display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed var(--border); flex-wrap: wrap; }
  .actions { display: flex; justify-content: space-between; margin-top: 14px; }
  .btn-col { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }

  .btn { background: var(--btn-bg); color: var(--btn-text); border: 1px solid var(--accent-deep); border-radius: 7px; padding: 7px 16px; font: inherit; font-size: 0.8125rem; cursor: pointer; }
  .btn:hover { background: var(--btn-bg-hover); }
  /* opacity: .4 put the label at 2.74:1 in dark and 1.81:1 in light — an
     unreadable button is not the same thing as a disabled one. Flat and
     colourless reads as "off" without hiding what the button says. */
  .btn:disabled { background: var(--chip-bg); color: var(--text-muted-2); border-color: var(--border-strong); cursor: default; }
  .btn.ghost { background: transparent; border-color: var(--border-strong); color: var(--text-muted-2); }
  .btn.ghost:hover { color: var(--text); border-color: var(--accent-deep); }
  .mini { background: transparent; border: 1px solid transparent; color: var(--text-muted); border-radius: 5px; padding: 2px 7px; cursor: pointer; font-size: 0.75rem; }
  .mini:hover { color: var(--accent); border-color: var(--border-strong); }
  .mini.danger { color: var(--neg); border-color: var(--neg-border); }
  .mini.danger:hover { color: var(--neg); background: var(--neg-bg); }
  .confirm { display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
  .confirm-q { font-size: 0.71875rem; color: var(--text-soft); }

  .banner { grid-column: span 3; background: var(--accent-bg-banner); border: 1px solid var(--accent-border); color: var(--accent-text-soft); border-radius: 10px; padding: 10px 14px; font-size: 0.8125rem; margin-bottom: 12px; }
  .banner.warn { background: var(--neg-bg); border-color: var(--neg-border); color: var(--neg-text-soft); }
  .callout { margin-top: 12px; padding: 10px 12px; border-left: 2px solid var(--accent-deep); background: var(--accent-bg-soft); font-size: 0.78125rem; color: var(--text-soft); border-radius: 0 8px 8px 0; }

  /* drilldown bar rows */
  .bar-row { display: grid; grid-template-columns: 110px 1fr 92px; gap: 10px; align-items: center; width: 100%; background: none; border: 0; color: var(--text-soft); font: inherit; font-size: 0.78125rem; padding: 5px 2px; cursor: pointer; text-align: left; border-radius: 6px; }
  .bar-row:hover { background: var(--surface-hover); }
  .bar-row .r, .bar-row .amt { text-align: right; }
  .bar-track { height: 7px; background: var(--track); border-radius: 4px; overflow: hidden; }
  .bar-fill { display: block; height: 100%; background: linear-gradient(90deg, var(--accent-deep), var(--neg)); border-radius: 4px; }

  /* annual timeline */
  .timeline { display: grid; grid-template-columns: repeat(12, 1fr); gap: 6px; }
  .tl-month { background: var(--surface-sunken); border: 1px solid var(--border); border-radius: 8px; min-height: 84px; padding: 6px; }
  .tl-month.now { border-color: var(--accent-deep); }
  .tl-label { font-size: 0.625rem; letter-spacing: .1em; color: var(--text-muted); margin-bottom: 5px; text-align: center; }
  .tl-item { font-size: 0.625rem; line-height: 1.3; background: var(--pending-bg); border: 1px solid var(--pending-border); color: var(--pending); border-radius: 6px; padding: 4px 5px; margin-bottom: 4px; }
  .tl-item.paid { background: var(--accent-bg); border-color: var(--accent-border); color: var(--accent); }

  /* imports */
  .steps { display: flex; gap: 10px; }
  .step { flex: 1; display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px; color: var(--text-muted); font-size: 0.8125rem; }
  .step.on { border-color: var(--accent-deep); color: var(--step-on-text); }
  .step.done { color: var(--text-muted-2); }
  .step-n { width: 22px; height: 22px; border-radius: 50%; border: 1px solid currentColor; display: grid; place-items: center; font-size: 0.6875rem; flex: none; }
  .step-txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .step-of { font-size: 0.625rem; letter-spacing: .08em; text-transform: uppercase; color: var(--text-muted); }
  .step.on .step-of, .step.done .step-of { color: inherit; }
  .drop { width: 100%; background: none; font: inherit; border: 1.5px dashed var(--drop-border); border-radius: 12px; padding: 34px 20px; text-align: center; color: var(--text-soft); cursor: pointer; display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .drop:hover:enabled { border-color: var(--accent-deep); background: var(--accent-bg-soft); }
  .drop.off, .drop:disabled { opacity: .45; cursor: default; }
  .drop-ic { font-size: 1.625rem; color: var(--accent-strong); }
  /* Only ever opened by the button above it — kept out of the tab order and out
     of the accessibility tree so it is not a second, silent stop. */
  .file-proxy { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

  /* scenario */
  .scen-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 8px; }
  .scen-grid[data-off="true"] { opacity: .35; pointer-events: none; }
  .scen-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 0.6875rem; color: var(--text-muted-2); }

  .recon { margin-top: 8px; border-top: 1px dashed var(--border); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .recon-row { display: flex; gap: 8px; } .recon-row input { flex: 1; min-width: 0; }
  .recon-result { font-size: 0.75rem; padding: 7px 10px; border-radius: 7px; }
  .recon-result.ok { background: var(--accent-bg); color: var(--accent); }
  .recon-result.bad { background: var(--warn-bg); color: var(--neg-text-soft); }

  .tip { background: var(--accent-bg-soft); border: 1px solid var(--accent-border); border-radius: 8px; padding: 8px 11px; font-size: 0.75rem; font-family: ui-monospace, Menlo, monospace; }
  .tip-t { color: var(--text-muted-2); margin-bottom: 4px; }

  /* explanations: a hover affordance for figures whose derivation is invisible,
     and a legend for the words used in the forecast's basis column */
  .help-wrap { position: relative; display: inline-block; }
  .help { display: inline-grid; place-items: center; width: 13px; height: 13px; margin-left: 5px; border-radius: 50%;
    border: 1px solid var(--border-strong); background: none; color: var(--text-muted); font: inherit; font-size: 0.5625rem;
    line-height: 1; letter-spacing: 0; padding: 0; cursor: help; vertical-align: 1px; }
  .help:hover, .help[aria-expanded="true"] { color: var(--accent); border-color: var(--accent-deep); }
  /* The explanation itself, on the page rather than in a title attribute no
     keyboard or touch user can summon. Resets the inherited table-header and
     stat-label casing so the sentence reads as a sentence. */
  .help-body { position: absolute; z-index: 40; top: calc(100% + 7px); right: -6px; width: 250px;
    background: var(--surface-raised); border: 1px solid var(--border-strong); border-radius: 9px;
    padding: 9px 11px; color: var(--text-soft); font-size: 0.71875rem; line-height: 1.5; font-weight: 400;
    letter-spacing: normal; text-transform: none; text-align: left; white-space: pre-wrap; }
  .l-txt { display: inline-flex; align-items: center; }
  .legend { display: flex; flex-wrap: wrap; gap: 6px 22px; margin-bottom: 12px; font-size: 0.71875rem; color: var(--text-muted); }
  .legend > span { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .scen-hint { font-size: 0.65625rem; line-height: 1.35; color: var(--text-faint); }

  @media (max-width: 1100px) {
    .grid { grid-template-columns: 1fr; }
    .span2, .span3, .stat-row, .banner { grid-column: span 1; }
    .nav { width: 64px; } .nav .brand-name, .nav .brand-sub, .nav-item { font-size: 0; }
    .nav-item .nav-ic { font-size: 0.9375rem; } .nav-foot, .nav-badge { display: none; }
    .timeline { grid-template-columns: repeat(4, 1fr); }
  }
`;
