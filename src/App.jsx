import React, { useState, useMemo, useRef, useEffect } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import {
  ResponsiveContainer, ComposedChart, AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Legend, Cell,
} from "recharts";

/* ============================================================
   MONEY — integer cents everywhere. No floats touch stored data.
   ============================================================ */
const toC = (v) => {
  if (v === null || v === undefined || v === "") return 0;
  const s = String(v).replace(/[^\d.\-,]/g, "");
  // handle "1,234.56" and "1.234,56"
  let n;
  if (/,\d{1,2}$/.test(s)) n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  else n = parseFloat(s.replace(/,/g, ""));
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
};
const C = (cents, cur = "R") => {
  const neg = cents < 0;
  const a = Math.abs(cents);
  const whole = Math.floor(a / 100).toLocaleString("en-US");
  const dec = String(a % 100).padStart(2, "0");
  return `${neg ? "\u2212" : ""}${cur}${whole}.${dec}`;
};
const C0 = (cents, cur = "R") => {
  const neg = cents < 0;
  return `${neg ? "\u2212" : ""}${cur}${Math.round(Math.abs(cents) / 100).toLocaleString("en-US")}`;
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

const parseDateAny = (raw, dayFirst = true) => {
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
  settings: { currency: "R", currentAge: 42, retirementAge: 65, planningAge: 90, inflationPct: 5.0, investReturnPct: 9.0, cashReturnPct: 4.0, cryptoReturnPct: 9.0, dayFirstDates: true },
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
const isFlow = (t, cats) => {
  if (t.excluded || t.transfer) return false;
  const c = cats.find((x) => x.id === t.categoryId);
  return !c || c.kind !== "transfer";
};

const accountBalance = (acc, txns, snapshots, uptoDate) => {
  if (acc.type === "investment" || acc.type === "crypto") {
    const snaps = snapshots.filter((s) => s.accountId === acc.id && (!uptoDate || s.date <= uptoDate)).sort((a, b) => a.date.localeCompare(b.date));
    if (snaps.length) return snaps[snaps.length - 1].balanceC;
    return acc.openingC;
  }
  const sum = txns.filter((t) => t.accountId === acc.id && !t.excluded && (!uptoDate || t.date <= uptoDate)).reduce((s, t) => s + t.amountC, 0);
  return acc.openingC + sum;
};

const monthlyPayment = (balanceC, ratePct, termMonths) => {
  const r = ratePct / 100 / 12;
  if (termMonths <= 0) return 0;
  if (r === 0) return Math.round(balanceC / termMonths);
  const f = Math.pow(1 + r, termMonths);
  return Math.round((balanceC * r * f) / (f - 1));
};

const amortise = (mortgage, months, rateOverridePct) => {
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
const matchRecurring = (item, txns, ym, cats) => {
  const hits = txns.filter((t) => !t.excluded && t.categoryId === item.categoryId && t.date.slice(0, 7) === ym);
  const actualC = hits.reduce((s, t) => s + t.amountC, 0);
  const paid = hits.length > 0;
  const varianceC = paid ? actualC - item.amountC : 0;
  const material = paid && Math.abs(varianceC) > Math.max(Math.abs(item.amountC) * 0.1, 10000);
  return { hits, actualC, paid, varianceC, material };
};
const matchAnnual = (item, txns, year) => {
  const ym = `${year}-${String(item.month).padStart(2, "0")}`;
  const hits = txns.filter((t) => !t.excluded && t.categoryId === item.categoryId && t.date.slice(0, 7) === ym);
  const actualC = hits.reduce((s, t) => s + t.amountC, 0);
  return { ym, hits, actualC, paid: hits.length > 0, varianceC: hits.length ? actualC - item.amountC : 0 };
};

/* 12-month forecast. Actuals replace plan for elapsed months. */
const buildForecast = (state, scenario) => {
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
    } else if (hasActuals) {
      usedIn = actIn; usedOut = actOut; mode = "actual";
    }
    const net = usedIn + usedOut;
    cum += net;
    rows.push({ ym, planIn, planOut, actIn, actOut, usedIn, usedOut, net, cum, mode,
      planNet: planIn + planOut, varianceC: mode !== "plan" ? net - (planIn + planOut) : 0 });
  }
  return { rows, mortPay: mortPayAdj };
};

/* Long-term annual projection to planning age */
const buildLongTerm = (state, scenario) => {
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
const parseOFX = (text) => {
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
      <style>{CSS}</style>
      <aside className="nav">
        <div className="brand">
          <div className="brand-mark">▚</div>
          <div><div className="brand-name">LEDGERLINE</div><div className="brand-sub">personal finance model</div></div>
        </div>
        {NAV.map(([k, label, ic]) => (
          <button key={k} className={`nav-item ${page === k ? "on" : ""}`} onClick={() => setPage(k)}>
            <span className="nav-ic">{ic}</span>{label}
            {k === "imports" && <span className="nav-badge">{state.batches.length}</span>}
          </button>
        ))}
        <div className="nav-foot">Prototype · in-memory data<br />Supabase-ready schema</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="crumb">{NAV.find((n) => n[0] === page)?.[1]}</div>
          {showMonthSel && (
            <div className="month-sel">
              <button onClick={() => setYm(ymAdd(ym, -1))}>‹</button>
              <span>{ymLabel(ym)}</span>
              <button onClick={() => setYm(ymAdd(ym, 1))}>›</button>
              {ym !== nowYm() && <button className="today" onClick={() => setYm(nowYm())}>today</button>}
            </div>
          )}
          <div className="scen-pill" data-on={state.scenario.enabled}>
            {state.scenario.enabled ? "SCENARIO OVERLAY ON" : "BASE CASE"}
          </div>
        </header>

        {page === "overview" && <Overview {...{ state, cur, ym, netWorth, monthSpend, monthIncome, budgetOut, fc, lt, goTxns, cats, catName }} />}
        {page === "transactions" && <Transactions {...{ state, update, cur, ym, txnFilter, setTxnFilter, cats, catName, accName }} />}
        {page === "accounts" && <Accounts {...{ state, update, cur, goTxns }} />}
        {page === "recurring" && <Recurring {...{ state, update, cur, ym, cats }} />}
        {page === "annual" && <Annual {...{ state, update, cur, ym, cats, goTxns }} />}
        {page === "compensation" && <Compensation {...{ state, update, cur }} />}
        {page === "forecast" && <Forecast {...{ state, update, cur, fc, fcScen }} />}
        {page === "longterm" && <LongTerm {...{ state, update, cur, lt, ltScen }} />}
        {page === "imports" && <Imports {...{ state, update, cur, cats, catName, accName }} />}
        {page === "settings" && <Settings {...{ state, update, cur, fc, lt, catName, accName }} />}
      </main>
    </div>
  );
}

/* ============================================================
   SHARED UI
   ============================================================ */
const Card = ({ title, right, children, className = "" }) => (
  <section className={`card ${className}`}>
    {(title || right) && <div className="card-head"><h3>{title}</h3><div>{right}</div></div>}
    {children}
  </section>
);
const Stat = ({ label, value, sub, tone, onClick }) => (
  <div className={`stat ${onClick ? "click" : ""}`} onClick={onClick}>
    <div className="stat-label">{label}</div>
    <div className={`stat-value ${tone || ""}`}>{value}</div>
    {sub && <div className="stat-sub">{sub}</div>}
  </div>
);
const Amt = ({ c, cur, zero }) => (
  <span className={`amt ${c > 0 ? "pos" : c < 0 ? "neg" : ""}`}>{zero && c === 0 ? "—" : C(c, cur)}</span>
);
const NumInput = ({ valueC, onCommit, className = "" }) => {
  const [v, setV] = useState(null);
  return (
    <input className={`num-in ${className}`} value={v === null ? (valueC / 100).toFixed(2) : v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== null) { onCommit(toC(v)); setV(null); } }}
      onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
  );
};
const PctInput = ({ value, onCommit, step = 0.1 }) => {
  const [v, setV] = useState(null);
  return (
    <input className="num-in pct" type="number" step={step} value={v === null ? value : v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { if (v !== null) { onCommit(parseFloat(v) || 0); setV(null); } }}
      onKeyDown={(e) => e.key === "Enter" && e.target.blur()} />
  );
};
const chartTip = (cur) => ({ payload, label, active }) =>
  active && payload && payload.length ? (
    <div className="tip">
      <div className="tip-t">{label}</div>
      {payload.map((p, i) => <div key={i} style={{ color: p.color }}>{p.name}: {C0(p.value, cur)}</div>)}
    </div>
  ) : null;

/* ============================================================
   PAGES
   ============================================================ */
function Overview({ state, cur, ym, netWorth, monthSpend, monthIncome, budgetOut, fc, lt, goTxns, cats, catName }) {
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
        <Stat label="Net worth" value={C0(netWorth.total, cur)} sub={`${C0(netWorth.assets, cur)} assets · ${C0(netWorth.liab, cur)} liabilities`} tone="pos" />
        <Stat label={`Income · ${ymShort(ym)}`} value={C0(monthIncome, cur)} tone="pos" onClick={() => goTxns({ search: "", category: "all" })} />
        <Stat label={`Spend · ${ymShort(ym)}`} value={C0(monthSpend, cur)} tone="neg" sub={`${spendPct}% of ${C0(budgetOut, cur)} budgeted`} onClick={() => goTxns({})} />
        <Stat label="12-mo forecast net" value={C0(fc.rows[11].cum, cur)} sub="cumulative cashflow" tone={fc.rows[11].cum >= 0 ? "pos" : "neg"} />
        <Stat label="Depletion check" value={lt.depletionAge ? `age ${lt.depletionAge}` : "clear"} sub={lt.depletionAge ? "assets exhausted" : `to age ${state.settings.planningAge}`} tone={lt.depletionAge ? "warn" : "pos"} />
      </div>

      <Card title="12-month cashflow ribbon" className="span2" right={<span className="muted-s">actual → blend → plan</span>}>
        <ResponsiveContainer width="100%" height={210}>
          <ComposedChart data={fc.rows.map((r) => ({ ...r, name: ymShort(r.ym) }))}>
            <CartesianGrid stroke="#1d2a24" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "#5f7a6d", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => C0(v, cur)} tick={{ fill: "#5f7a6d", fontSize: 11 }} axisLine={false} tickLine={false} width={70} />
            <Tooltip content={chartTip(cur)} />
            <ReferenceLine y={0} stroke="#33463d" />
            <Bar dataKey="net" name="Net flow" radius={[3, 3, 0, 0]}>
              {fc.rows.map((r, i) => <Cell key={i} fill={r.mode !== "plan" ? (r.net >= 0 ? "#46c98c" : "#e0a24a") : (r.net >= 0 ? "#2a5c46" : "#6e5730")} />)}
            </Bar>
            <Line dataKey="cum" name="Cumulative" stroke="#8fe6bd" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>

      <Card title={`Top spend categories · ${ymShort(ym)}`}>
        {catRows.length === 0 && <div className="empty">No categorised spend this month yet. Import a statement to populate actuals.</div>}
        {catRows.map((r) => (
          <button key={r.id} className="bar-row" onClick={() => goTxns({ category: r.id })}>
            <span>{r.name}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${Math.min(100, (Math.abs(r.c) / Math.abs(catRows[0].c)) * 100)}%` }} /></span>
            <span className="amt neg">{C(r.c, cur)}</span>
          </button>
        ))}
      </Card>

      <Card title={`Still pending · ${ymShort(ym)}`} right={<span className="muted-s">{pendingRecurring.length} expected items unmatched</span>}>
        {pendingRecurring.length === 0 && <div className="empty">Every expected recurring item is matched to an actual. Fully reconciled month.</div>}
        <table className="tbl">
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
      </Card>

      <Card title="Net worth trajectory" className="span2">
        <ResponsiveContainer width="100%" height={190}>
          <AreaChart data={lt.rows.map((r) => ({ name: r.age, nw: r.netWorthC }))}>
            <CartesianGrid stroke="#1d2a24" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "#5f7a6d", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => C0(v, cur)} tick={{ fill: "#5f7a6d", fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
            <Tooltip content={chartTip(cur)} />
            <ReferenceLine x={state.settings.retirementAge} stroke="#e0a24a" strokeDasharray="4 3" label={{ value: "retire", fill: "#e0a24a", fontSize: 11 }} />
            <Area dataKey="nw" name="Net worth" stroke="#46c98c" fill="url(#nwg)" strokeWidth={2} />
            <defs><linearGradient id="nwg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#46c98c" stopOpacity={0.28} /><stop offset="100%" stopColor="#46c98c" stopOpacity={0.02} /></linearGradient></defs>
          </AreaChart>
        </ResponsiveContainer>
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
          <input placeholder="Search description…" value={f.search} onChange={(e) => setTxnFilter({ ...f, search: e.target.value })} />
          <select value={f.account} onChange={(e) => setTxnFilter({ ...f, account: e.target.value })}>
            <option value="all">All accounts</option>
            {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <select value={f.category} onChange={(e) => setTxnFilter({ ...f, category: e.target.value })}>
            <option value="all">All categories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="muted-s">net <Amt c={total} cur={cur} /></span>
        </div>
      }>
        {rows.length === 0 && <div className="empty">No transactions for this month and filter. Use Imports to load a statement, or add one manually below.</div>}
        <table className="tbl">
          <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Category</th><th className="r">Amount</th><th>Flags</th><th></th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={t.excluded ? "dim" : ""}>
                <td className="mono">{t.date.slice(5)}</td>
                <td>{t.desc}</td>
                <td className="muted-s">{accName(t.accountId)}</td>
                <td>
                  <select className="cat-sel" value={t.categoryId} onChange={(e) => setTxn(t.id, { categoryId: e.target.value }, `Recategorised "${t.desc}" → ${catName(e.target.value)}`)}>
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
                  <button className="mini" title="Mark as transfer between own accounts" onClick={() => setTxn(t.id, { transfer: !t.transfer }, `${t.transfer ? "Unmarked" : "Marked"} "${t.desc}" as transfer`)}>⇄</button>
                  <button className="mini" title="Exclude from all analysis" onClick={() => setTxn(t.id, { excluded: !t.excluded }, `${t.excluded ? "Restored" : "Excluded"} "${t.desc}"`)}>{t.excluded ? "↺" : "✕"}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <AddTxn state={state} update={update} ym={ym} cats={cats} />
      </Card>
    </div>
  );
}

function AddTxn({ state, update, ym, cats }) {
  const [d, setD] = useState({ date: `${ym}-15`, desc: "", amount: "", accountId: state.accounts[0].id, categoryId: "cat_uncat" });
  return (
    <div className="add-row">
      <input type="date" value={d.date} onChange={(e) => setD({ ...d, date: e.target.value })} />
      <input placeholder="Description" value={d.desc} onChange={(e) => setD({ ...d, desc: e.target.value })} style={{ flex: 1 }} />
      <select value={d.accountId} onChange={(e) => setD({ ...d, accountId: e.target.value })}>{state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <select value={d.categoryId} onChange={(e) => setD({ ...d, categoryId: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <input placeholder="Amount (− = out)" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} style={{ width: 130 }} />
      <button className="btn" disabled={!d.desc || !d.amount} onClick={() => {
        update((s) => ({ ...s, txns: [...s.txns, { id: uid("txn"), accountId: d.accountId, date: d.date, desc: d.desc, amountC: toC(d.amount), categoryId: d.categoryId, source: "manual" }] }), "manual", `Manual transaction "${d.desc}" ${d.amount}`);
        setD({ ...d, desc: "", amount: "" });
      }}>Add</button>
    </div>
  );
}

function Accounts({ state, update, cur, goTxns }) {
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
                right={<button className="mini" onClick={() => goTxns({ account: acc.id })}>view txns →</button>}>
                <div className="acc-bal"><Amt c={bal} cur={cur} /></div>
                <ResponsiveContainer width="100%" height={90}>
                  <AreaChart data={history(acc)}>
                    <XAxis dataKey="name" hide /><YAxis hide domain={["auto", "auto"]} />
                    <Tooltip content={chartTip(cur)} />
                    <Area dataKey="bal" name="Balance" stroke={bal >= 0 ? "#46c98c" : "#e0a24a"} fill="none" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
                {isSnap ? (
                  <div className="recon">
                    <div className="muted-s">Manual balance snapshot</div>
                    <div className="recon-row">
                      <input type="date" value={(snap[acc.id] || {}).date || todayISO()} onChange={(e) => setSnap({ ...snap, [acc.id]: { ...(snap[acc.id] || {}), date: e.target.value } })} />
                      <input placeholder="Balance" value={(snap[acc.id] || {}).balance || ""} onChange={(e) => setSnap({ ...snap, [acc.id]: { ...(snap[acc.id] || {}), balance: e.target.value } })} />
                      <button className="btn" disabled={!(snap[acc.id] || {}).balance} onClick={() => {
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
                      <input type="date" value={r.date || ""} onChange={(e) => setRecon({ ...recon, [acc.id]: { ...r, date: e.target.value } })} />
                      <input placeholder="Statement balance" value={r.balance || ""} onChange={(e) => setRecon({ ...recon, [acc.id]: { ...r, balance: e.target.value } })} />
                    </div>
                    {diff !== null && (
                      <div className={`recon-result ${diff === 0 ? "ok" : "bad"}`}>
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
        <Stat label="Monthly income (model)" value={C0(totIn, cur)} tone="pos" />
        <Stat label="Monthly expenses (model)" value={C0(totOut, cur)} tone="neg" />
        <Stat label="Planned monthly net" value={C0(totIn + totOut, cur)} tone={totIn + totOut >= 0 ? "pos" : "neg"} sub="excl. annual items & transfers" />
      </div>
      <Card className="span3" title="Regular monthly income & expenses" right={<span className="muted-s">edits feed the forecast and long-term plan immediately</span>}>
        <table className="tbl">
          <thead><tr><th>Item</th><th>Category</th><th>Expected day</th><th className="r">Amount / month</th><th>This month ({ymShort(ym)})</th><th className="r">Variance</th><th></th></tr></thead>
          <tbody>
            {state.recurring.map((r) => {
              const m = matchRecurring(r, state.txns, ym, cats);
              const isTransfer = (cats.find((c) => c.id === r.categoryId) || {}).kind === "transfer";
              return (
                <tr key={r.id}>
                  <td><input className="cell-in" value={r.name} onChange={(e) => update((s) => ({ ...s, recurring: s.recurring.map((x) => x.id === r.id ? { ...x, name: e.target.value } : x) }))} /></td>
                  <td>
                    <select className="cat-sel" value={r.categoryId} onChange={(e) => update((s) => ({ ...s, recurring: s.recurring.map((x) => x.id === r.id ? { ...x, categoryId: e.target.value } : x) }), "edit", `Recurring "${r.name}" category changed`)}>
                      {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </td>
                  <td><input className="cell-in day" type="number" min="1" max="31" value={r.day} onChange={(e) => update((s) => ({ ...s, recurring: s.recurring.map((x) => x.id === r.id ? { ...x, day: +e.target.value } : x) }))} /></td>
                  <td className="r"><NumInput valueC={r.amountC} onCommit={(c) => update((s) => ({ ...s, recurring: s.recurring.map((x) => x.id === r.id ? { ...x, amountC: c } : x) }), "edit", `Recurring "${r.name}" amount → ${C(c, cur)}`)} /></td>
                  <td>{isTransfer ? <span className="chip transfer">transfer</span> : m.paid ? <span className="chip ok">actualised {C(m.actualC, cur)}</span> : <span className="chip pending">pending</span>}</td>
                  <td className="r">{m.paid && !isTransfer ? <span className={`amt ${m.material ? "warn" : "muted-s"}`}>{m.varianceC === 0 ? "on plan" : C(m.varianceC, cur)}{m.material ? " ⚠" : ""}</span> : "—"}</td>
                  <td className="r"><button className="mini" onClick={() => update((s) => ({ ...s, recurring: s.recurring.filter((x) => x.id !== r.id) }), "edit", `Removed recurring item "${r.name}"`)}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
        <Stat label="Monthly equivalent" value={C0(Math.round(tot / 12), cur)} sub="worth provisioning in cash buffer" />
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
      <Card className="span3" title="Annual & irregular expenses" right={<span className="muted-s">escalation applies each year in forecasts</span>}>
        <table className="tbl">
          <thead><tr><th>Item</th><th>Category</th><th>Month</th><th className="r">Amount</th><th>Escalation %/yr</th><th>Status · {year}</th><th className="r">Variance</th><th></th></tr></thead>
          <tbody>
            {state.annual.map((a) => {
              const m = matchAnnual(a, state.txns, year);
              return (
                <tr key={a.id}>
                  <td><input className="cell-in" value={a.name} onChange={(e) => update((s) => ({ ...s, annual: s.annual.map((x) => x.id === a.id ? { ...x, name: e.target.value } : x) }))} /></td>
                  <td><select className="cat-sel" value={a.categoryId} onChange={(e) => update((s) => ({ ...s, annual: s.annual.map((x) => x.id === a.id ? { ...x, categoryId: e.target.value } : x) }))}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                  <td><select className="cat-sel" value={a.month} onChange={(e) => update((s) => ({ ...s, annual: s.annual.map((x) => x.id === a.id ? { ...x, month: +e.target.value } : x) }))}>{MONTHS.map((mn, i) => <option key={mn} value={i + 1}>{mn}</option>)}</select></td>
                  <td className="r"><NumInput valueC={a.amountC} onCommit={(c) => update((s) => ({ ...s, annual: s.annual.map((x) => x.id === a.id ? { ...x, amountC: c } : x) }), "edit", `Annual "${a.name}" amount → ${C(c, cur)}`)} /></td>
                  <td><PctInput value={a.escalationPct} onCommit={(v) => update((s) => ({ ...s, annual: s.annual.map((x) => x.id === a.id ? { ...x, escalationPct: v } : x) }))} /></td>
                  <td>{m.paid ? <button className="chip ok click" onClick={() => goTxns({ category: a.categoryId })}>paid {C(m.actualC, cur)}</button> : <span className="chip pending">due {MONTHS[a.month - 1]}</span>}</td>
                  <td className="r">{m.paid ? <Amt c={m.varianceC} cur={cur} zero /> : "—"}</td>
                  <td className="r"><button className="mini" onClick={() => update((s) => ({ ...s, annual: s.annual.filter((x) => x.id !== a.id) }), "edit", `Removed annual item "${a.name}"`)}>✕</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="btn ghost" onClick={() => update((s) => ({ ...s, annual: [...s.annual, { id: uid("ann"), name: "New annual item", categoryId: "cat_general", month: 1, amountC: -50000, escalationPct: 5 }] }), "edit", "Added annual item")}>+ Add annual item</button>
      </Card>
    </div>
  );
}

function Compensation({ state, update, cur }) {
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
          <label>Bonus paid in<select className="cat-sel" value={comp.bonusMonth} onChange={(e) => setComp({ bonusMonth: +e.target.value }, "Bonus month changed")}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select></label>
          <label>Salary growth %/yr<PctInput value={comp.salaryGrowthPct} onCommit={(v) => setComp({ salaryGrowthPct: v }, `Salary growth → ${v}%`)} /></label>
        </div>
        <div className="callout">Annual package at target: <b>{C0(Math.round(comp.salaryMonthlyC * 12 * (1 + comp.bonusTargetPct / 100)), cur)}</b> — flows into the forecast (bonus in {MONTHS[comp.bonusMonth - 1]}) and the long-term plan (growth until retirement).</div>
      </Card>
      <Card title="Mortgage">
        <div className="form">
          <label>Outstanding balance<NumInput valueC={mortgage.balanceC} onCommit={(c) => setMort({ balanceC: c }, `Mortgage balance → ${C(c, cur)}`)} /></label>
          <label>Interest rate %<PctInput value={mortgage.ratePct} onCommit={(v) => setMort({ ratePct: v }, `Mortgage rate → ${v}%`)} step={0.05} /></label>
          <label>Remaining term (months)<PctInput value={mortgage.termMonths} onCommit={(v) => setMort({ termMonths: Math.round(v) }, `Mortgage term → ${v} months`)} step={1} /></label>
          <label>Fixed rate expires<input type="month" className="cell-in" value={mortgage.fixedExpiry} onChange={(e) => setMort({ fixedExpiry: e.target.value }, "Fixed-rate expiry changed")} /></label>
          <label>Actual monthly payment (override, 0 = computed)<NumInput valueC={mortgage.paymentOverrideC || 0} onCommit={(c) => setMort({ paymentOverrideC: c || null }, `Mortgage payment override → ${C(c, cur)}`)} /></label>
          <label>Property value (estimate)<NumInput valueC={mortgage.propertyValueC || 0} onCommit={(c) => setMort({ propertyValueC: c }, `Property value → ${C(c, cur)}`)} /></label>
        </div>
        <div className="callout">Payment used: <b>{C(am.paymentC, cur)}/mo</b> · projected payoff <b>{payoffYm === "—" ? "—" : ymLabel(payoffYm)}</b> · fixed rate ends <b>{ymLabel(mortgage.fixedExpiry)}</b> — after which the forecast scenario rate change applies.</div>
      </Card>
      <Card className="span2" title="Amortisation — balance & interest vs principal (annual view)">
        <ResponsiveContainer width="100%" height={230}>
          <ComposedChart data={yearMarks.map((r, i) => ({ name: r.ym.slice(0, 4), bal: r.balanceC, int: am.rows.slice(i * 12, i * 12 + 12).reduce((s, x) => s + x.interestC, 0), prin: am.rows.slice(i * 12, i * 12 + 12).reduce((s, x) => s + x.principalC, 0) }))}>
            <CartesianGrid stroke="#1d2a24" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "#5f7a6d", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => C0(v, cur)} tick={{ fill: "#5f7a6d", fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
            <Tooltip content={chartTip(cur)} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="int" name="Interest / yr" stackId="a" fill="#e0a24a" radius={[0, 0, 0, 0]} />
            <Bar dataKey="prin" name="Principal / yr" stackId="a" fill="#2f8f63" radius={[3, 3, 0, 0]} />
            <Line dataKey="bal" name="Balance" stroke="#8fe6bd" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function ScenarioPanel({ state, update }) {
  const sc = state.scenario;
  const set = (patch) => update((s) => ({ ...s, scenario: { ...s.scenario, ...patch } }));
  return (
    <Card title="Scenario overlay" className="span3 scen" right={
      <label className="switch"><input type="checkbox" checked={sc.enabled} onChange={(e) => set({ enabled: e.target.checked })} /><span>{sc.enabled ? "On — base case preserved" : "Off"}</span></label>
    }>
      <div className="scen-grid" data-off={!sc.enabled}>
        <label>Salary / bonus change %<PctInput value={sc.salaryPct} onCommit={(v) => set({ salaryPct: v })} step={0.5} /></label>
        <label>Spending adjustment %<PctInput value={sc.spendPct} onCommit={(v) => set({ spendPct: v })} step={0.5} /></label>
        <label>Inflation delta %<PctInput value={sc.inflationDelta} onCommit={(v) => set({ inflationDelta: v })} step={0.25} /></label>
        <label>Mortgage rate delta %<PctInput value={sc.rateDelta} onCommit={(v) => set({ rateDelta: v })} step={0.25} /></label>
        <label>Investment return delta %<PctInput value={sc.returnDelta} onCommit={(v) => set({ returnDelta: v })} step={0.25} /></label>
      </div>
      <div className="muted-s">The overlay is drawn alongside the base case; it never overwrites your model.</div>
    </Card>
  );
}

function Forecast({ state, update, cur, fc, fcScen }) {
  const chart = fc.rows.map((r, i) => ({ name: ymShort(r.ym), base: r.cum, scen: fcScen ? fcScen.rows[i].cum : undefined }));
  return (
    <div className="grid">
      <ScenarioPanel state={state} update={update} />
      <Card className="span3" title="Cumulative 12-month cashflow">
        <ResponsiveContainer width="100%" height={230}>
          <LineChart data={chart}>
            <CartesianGrid stroke="#1d2a24" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "#5f7a6d", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => C0(v, cur)} tick={{ fill: "#5f7a6d", fontSize: 11 }} axisLine={false} tickLine={false} width={80} />
            <Tooltip content={chartTip(cur)} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={0} stroke="#33463d" />
            <Line dataKey="base" name="Base case" stroke="#46c98c" strokeWidth={2} dot={false} />
            {fcScen && <Line dataKey="scen" name="Scenario" stroke="#e0a24a" strokeWidth={2} strokeDasharray="6 3" dot={false} />}
          </LineChart>
        </ResponsiveContainer>
      </Card>
      <Card className="span3" title="Monthly detail" right={<span className="muted-s">actual / blend months replace plan once transactions are matched</span>}>
        <table className="tbl">
          <thead><tr><th>Month</th><th>Basis</th><th className="r">Income</th><th className="r">Outgoings</th><th className="r">Net</th><th className="r">vs plan</th><th className="r">Cumulative</th>{fcScen && <th className="r">Scenario net</th>}</tr></thead>
          <tbody>
            {fc.rows.map((r, i) => (
              <tr key={r.ym} className={r.mode !== "plan" ? "hl" : ""}>
                <td>{ymLabel(r.ym)}</td>
                <td><span className={`chip ${r.mode === "plan" ? "ghost" : r.mode === "blend" ? "pending" : "ok"}`}>{r.mode}</span></td>
                <td className="r"><Amt c={r.usedIn} cur={cur} /></td>
                <td className="r"><Amt c={r.usedOut} cur={cur} /></td>
                <td className="r"><Amt c={r.net} cur={cur} /></td>
                <td className="r">{r.mode !== "plan" ? <span className={`amt ${Math.abs(r.varianceC) > Math.abs(r.planNet) * 0.1 ? "warn" : "muted-s"}`}>{C(r.varianceC, cur)}</span> : "—"}</td>
                <td className="r"><Amt c={r.cum} cur={cur} /></td>
                {fcScen && <td className="r"><span className="amt scen-amt">{C(fcScen.rows[i].net, cur)}</span></td>}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function LongTerm({ state, update, cur, lt, ltScen }) {
  const st = state.settings;
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
      <Card className="span3" title="Assets vs liabilities to planning age" right={<span className="muted-s">history = actual balances today · forecast beyond</span>}>
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={chart}>
            <CartesianGrid stroke="#1d2a24" vertical={false} />
            <XAxis dataKey="name" tick={{ fill: "#5f7a6d", fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tickFormatter={(v) => C0(v, cur)} tick={{ fill: "#5f7a6d", fontSize: 11 }} axisLine={false} tickLine={false} width={86} />
            <Tooltip content={chartTip(cur)} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine x={st.retirementAge} stroke="#e0a24a" strokeDasharray="4 3" />
            <Area dataKey="cash" name="Cash" stackId="a" fill="#1f4d38" stroke="none" />
            <Area dataKey="invest" name="Investments" stackId="a" fill="#2f8f63" stroke="none" />
            <Area dataKey="crypto" name="Crypto" stackId="a" fill="#57c491" stroke="none" />
            <Area dataKey="property" name="Property" stackId="a" fill="#28402f" stroke="none" />
            <Area dataKey="mort" name="Mortgage" fill="#5c3c22" stroke="none" />
            <Line dataKey="nw" name="Net worth (base)" stroke="#eafff4" strokeWidth={2} dot={false} />
            {ltScen && <Line dataKey="scen" name="Net worth (scenario)" stroke="#e0a24a" strokeWidth={2} strokeDasharray="6 3" dot={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
      <Card className="span3" title="Annual projection" right={
        <label className="muted-s">Planning age <PctInput value={st.planningAge} step={1} onCommit={(v) => update((s) => ({ ...s, settings: { ...s.settings, planningAge: Math.round(v) } }), "edit", `Planning age → ${v}`)} /></label>
      }>
        <div className="scroll-y">
          <table className="tbl">
            <thead><tr><th>Year</th><th>Age</th><th></th><th className="r">Income</th><th className="r">Spend</th><th className="r">Net</th><th className="r">Cash</th><th className="r">Investments</th><th className="r">Property</th><th className="r">Mortgage</th><th className="r">Net worth</th></tr></thead>
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
        </div>
      </Card>
    </div>
  );
}

/* ============================================================
   IMPORTS — upload → map columns → stage → review → commit
   ============================================================ */
function Imports({ state, update, cur, cats, catName, accName }) {
  const [step, setStep] = useState("upload"); // upload | map | review
  const [file, setFile] = useState(null);
  const [raw, setRaw] = useState(null); // {headers, rows} or {ofx:[...]}
  const [map, setMap] = useState({ date: "", desc: "", amount: "", debit: "", credit: "", invert: false, accountId: state.accounts[0].id, mode: "single" });
  const [staged, setStaged] = useState([]);
  const [err, setErr] = useState("");
  const fileRef = useRef();

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
    setStep("upload"); setStaged([]); setRaw(null); setFile(null);
  };

  const stats = {
    inc: staged.filter((s) => s.include).length,
    dup: staged.filter((s) => s.dup).length,
    low: staged.filter((s) => s.confidence === "low").length,
  };

  return (
    <div className="grid">
      <div className="steps span3">
        {["upload", "map", "review"].map((s, i) => (
          <div key={s} className={`step ${step === s ? "on" : ""} ${["upload","map","review"].indexOf(step) > i ? "done" : ""}`}>
            <span className="step-n">{i + 1}</span>{s === "upload" ? "Upload statement" : s === "map" ? "Map columns" : "Review & commit"}
          </div>
        ))}
      </div>

      {step === "upload" && (
        <>
          <Card className="span2" title="Upload a statement export">
            <div className="drop" onClick={() => fileRef.current.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}>
              <div className="drop-ic">⇪</div>
              <div>Drop a bank / credit-card / investment export here, or click to browse</div>
              <div className="muted-s">CSV · XLSX · OFX/QFX &nbsp;·&nbsp; <span className="chip warn">PDF — experimental</span></div>
              <input ref={fileRef} type="file" hidden accept=".csv,.xlsx,.xls,.ofx,.qfx,.pdf,.txt" onChange={(e) => e.target.files[0] && handleFile(e.target.files[0])} />
            </div>
            <div className="form" style={{ marginTop: 12 }}>
              <label>Import into account
                <select className="cat-sel" value={map.accountId} onChange={(e) => setMap({ ...map, accountId: e.target.value })}>
                  {state.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
            </div>
            {err && <div className="banner warn">{err}</div>}
            <p className="muted">No bank connections, no stored credentials — you stay in control of what enters the model. Nothing is saved until you commit on the review screen.</p>
          </Card>
          <Card title="Merchant rules" right={<span className="muted-s">drive auto-categorisation</span>}>
            <div className="scroll-y" style={{ maxHeight: 260 }}>
              <table className="tbl">
                <thead><tr><th>If description contains</th><th>Categorise as</th><th></th></tr></thead>
                <tbody>
                  {state.rules.map((r) => (
                    <tr key={r.id}>
                      <td><input className="cell-in mono" value={r.pattern} onChange={(e) => update((s) => ({ ...s, rules: s.rules.map((x) => x.id === r.id ? { ...x, pattern: e.target.value } : x) }))} /></td>
                      <td><select className="cat-sel" value={r.categoryId} onChange={(e) => update((s) => ({ ...s, rules: s.rules.map((x) => x.id === r.id ? { ...x, categoryId: e.target.value } : x) }), "rule", `Rule "${r.pattern}" → ${catName(e.target.value)}`)}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                      <td><button className="mini" onClick={() => update((s) => ({ ...s, rules: s.rules.filter((x) => x.id !== r.id) }), "rule", `Deleted rule "${r.pattern}"`)}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn ghost" onClick={() => update((s) => ({ ...s, rules: [{ id: uid("rule"), pattern: "NEW PATTERN", categoryId: "cat_general" }, ...s.rules] }), "rule", "Added merchant rule")}>+ Add rule</button>
          </Card>
          <Card className="span3" title="Import history">
            <table className="tbl">
              <thead><tr><th>When</th><th>File</th><th className="r">Transactions</th><th>Accounts</th></tr></thead>
              <tbody>
                {state.batches.map((b) => (
                  <tr key={b.id}><td className="mono">{b.when}</td><td>{b.filename}</td><td className="r mono">{b.count}</td><td className="muted-s">{b.accountIds.map(accName).join(", ")}</td></tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {step === "map" && raw && (
        <Card className="span3" title={`Map columns — ${file.name}`} right={<span className="muted-s">{raw.rows.length} rows detected</span>}>
          <div className="form form-row">
            <label>Date column<select className="cat-sel" value={map.date} onChange={(e) => setMap({ ...map, date: e.target.value })}><option value="">—</option>{raw.headers.map((h) => <option key={h}>{h}</option>)}</select></label>
            <label>Description column<select className="cat-sel" value={map.desc} onChange={(e) => setMap({ ...map, desc: e.target.value })}><option value="">—</option>{raw.headers.map((h) => <option key={h}>{h}</option>)}</select></label>
            <label>Amount layout
              <select className="cat-sel" value={map.mode} onChange={(e) => setMap({ ...map, mode: e.target.value })}>
                <option value="single">Single signed amount column</option>
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
          <table className="tbl">
            <thead><tr><th>Date</th><th>Description</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {raw.rows.slice(0, 5).map((r, i) => {
                const date = parseDateAny(r[map.date], state.settings.dayFirstDates);
                let amt = map.mode === "split" ? toC(r[map.credit]) - Math.abs(toC(r[map.debit])) : toC(r[map.amount]) * (map.invert ? -1 : 1);
                return <tr key={i}><td className="mono">{date || <span className="warn-t">unreadable</span>}</td><td>{String(r[map.desc] ?? "")}</td><td className="r"><Amt c={amt} cur={cur} /></td></tr>;
              })}
            </tbody>
          </table>
          {err && <div className="banner warn">{err}</div>}
          <div className="actions">
            <button className="btn ghost" onClick={() => { setStep("upload"); setErr(""); }}>← Back</button>
            <button className="btn" disabled={!map.date || (map.mode === "single" ? !map.amount : !map.debit && !map.credit)} onClick={runMapping}>Stage {raw.rows.length} rows →</button>
          </div>
        </Card>
      )}

      {step === "review" && (
        <Card className="span3" title="Review staged transactions" right={
          <span className="muted-s">{stats.inc} to commit · <span className="warn-t">{stats.dup} likely duplicates</span> · <span className="warn-t">{stats.low} low-confidence</span></span>
        }>
          <div className="banner">Nothing has been saved yet. Duplicates were auto-deselected; low-confidence categorisations are flagged <span className="chip warn">low</span> — fix them here or add a merchant rule so next month's import lands clean.</div>
          <div className="scroll-y" style={{ maxHeight: 420 }}>
            <table className="tbl">
              <thead><tr><th></th><th>Date</th><th>Description</th><th className="r">Amount</th><th>Category</th><th>Confidence</th><th>Flags</th><th>Rule</th></tr></thead>
              <tbody>
                {staged.map((t) => (
                  <tr key={t.id} className={!t.include ? "dim" : ""}>
                    <td><input type="checkbox" checked={t.include} onChange={(e) => setStg(t.id, { include: e.target.checked })} /></td>
                    <td className="mono">{t.date}</td>
                    <td>{t.desc}</td>
                    <td className="r"><Amt c={t.amountC} cur={cur} /></td>
                    <td><select className="cat-sel" value={t.categoryId} onChange={(e) => setStg(t.id, { categoryId: e.target.value, confidence: "manual" })}>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                    <td><span className={`chip ${t.confidence === "high" ? "ok" : t.confidence === "medium" ? "pending" : t.confidence === "manual" ? "ghost" : "warn"}`}>{t.confidence}</span></td>
                    <td>{t.dup && <span className="chip warn">duplicate?</span>}</td>
                    <td>{t.confidence !== "high" && (
                      <button className="mini" title="Create a merchant rule from this description" onClick={() => {
                        const pattern = t.desc.toUpperCase().split(/\s+/).slice(0, 2).join(" ");
                        update((s) => ({ ...s, rules: [{ id: uid("rule"), pattern, categoryId: t.categoryId }, ...s.rules] }), "rule", `Rule from import: "${pattern}" → ${catName(t.categoryId)}`);
                        setStaged((s) => s.map((x) => x.desc.toUpperCase().includes(pattern) ? { ...x, categoryId: t.categoryId, confidence: "high" } : x));
                      }}>+rule</button>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions">
            <button className="btn ghost" onClick={() => setStep(raw ? "map" : "upload")}>← Back</button>
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
function Settings({ state, update, cur, fc, lt, catName, accName }) {
  const st = state.settings;
  const set = (patch, msg) => update((s) => ({ ...s, settings: { ...s.settings, ...patch } }), "edit", msg);
  return (
    <div className="grid">
      <Card title="Assumptions">
        <div className="form">
          <label>Currency symbol<input className="cell-in" style={{ width: 60 }} value={st.currency} onChange={(e) => set({ currency: e.target.value })} /></label>
          <label>Current age<PctInput value={st.currentAge} step={1} onCommit={(v) => set({ currentAge: Math.round(v) }, `Current age → ${v}`)} /></label>
          <label>Retirement age<PctInput value={st.retirementAge} step={1} onCommit={(v) => set({ retirementAge: Math.round(v) }, `Retirement age → ${v}`)} /></label>
          <label>Planning age (horizon)<PctInput value={st.planningAge} step={1} onCommit={(v) => set({ planningAge: Math.round(v) }, `Planning age → ${v}`)} /></label>
          <label>Inflation %/yr<PctInput value={st.inflationPct} onCommit={(v) => set({ inflationPct: v }, `Inflation → ${v}%`)} /></label>
          <label>Investment return %/yr<PctInput value={st.investReturnPct} onCommit={(v) => set({ investReturnPct: v }, `Investment return → ${v}%`)} /></label>
          <label>Crypto return %/yr<PctInput value={st.cryptoReturnPct} onCommit={(v) => set({ cryptoReturnPct: v }, `Crypto return → ${v}%`)} /></label>
          <label>Cash return %/yr<PctInput value={st.cashReturnPct} onCommit={(v) => set({ cashReturnPct: v }, `Cash return → ${v}%`)} /></label>
          <label className="chk"><input type="checkbox" checked={st.dayFirstDates} onChange={(e) => set({ dayFirstDates: e.target.checked })} /> Statement dates are day-first (dd/mm/yyyy)</label>
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
        <p className="muted-s" style={{ marginTop: 10 }}>When signed in, every change autosaves to your account (per-user, row-level security). In demo mode, data lives in memory for this session only. The data layer is structured as relational tables (accounts, transactions, categories, rules, annual rules, compensation, mortgage, batches, assumptions, audit).</p>
      </Card>
      <Card className="span3" title="Audit trail" right={<span className="muted-s">{state.audit.length} events — every import, edit, exclusion and rule change</span>}>
        <div className="scroll-y" style={{ maxHeight: 340 }}>
          <table className="tbl">
            <thead><tr><th>When</th><th>Type</th><th>Detail</th></tr></thead>
            <tbody>
              {state.audit.map((a) => (
                <tr key={a.id}><td className="mono">{a.when}</td><td><span className={`chip ${a.kind === "import" ? "ok" : a.kind === "rule" ? "pending" : "ghost"}`}>{a.kind}</span></td><td>{a.detail}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
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
  .app { display: flex; min-height: 100vh; background: #0b1210; color: #d7e5dd;
    font: 14px/1.45 -apple-system, "Segoe UI", Inter, Roboto, sans-serif; }
  .mono, .amt, .num-in, .stat-value, .acc-bal, td.mono, .tl-item b { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-variant-numeric: tabular-nums; }

  /* nav */
  .nav { width: 216px; flex: none; background: #0e1714; border-right: 1px solid #1a2621; padding: 18px 10px; display: flex; flex-direction: column; gap: 2px; position: sticky; top: 0; height: 100vh; }
  .brand { display: flex; gap: 10px; align-items: center; padding: 4px 8px 18px; }
  .brand-mark { width: 34px; height: 34px; border-radius: 8px; background: linear-gradient(135deg, #123527, #2f8f63); display: grid; place-items: center; color: #bff3d9; font-size: 17px; }
  .brand-name { font-weight: 700; letter-spacing: .18em; font-size: 12px; color: #eafff4; }
  .brand-sub { font-size: 10px; color: #5f7a6d; letter-spacing: .04em; }
  .nav-item { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 8px 10px; border: 0; border-radius: 7px; background: transparent; color: #8ba899; font-size: 13px; cursor: pointer; }
  .nav-item:hover { background: #142019; color: #d7e5dd; }
  .nav-item.on { background: #16281f; color: #7ee2ae; box-shadow: inset 2px 0 0 #46c98c; }
  .nav-ic { width: 16px; text-align: center; opacity: .8; }
  .nav-badge { margin-left: auto; background: #1d3328; color: #7ee2ae; border-radius: 9px; font-size: 10px; padding: 1px 7px; }
  .nav-foot { margin-top: auto; font-size: 10px; color: #43584d; padding: 10px 8px 0; line-height: 1.6; border-top: 1px solid #1a2621; }

  /* layout */
  .main { flex: 1; padding: 0 26px 40px; min-width: 0; }
  .topbar { display: flex; align-items: center; gap: 18px; padding: 16px 0 14px; border-bottom: 1px solid #1a2621; margin-bottom: 18px; position: sticky; top: 0; background: #0b1210ee; backdrop-filter: blur(4px); z-index: 5; }
  .crumb { font-size: 17px; font-weight: 600; color: #eafff4; }
  .month-sel { display: flex; align-items: center; gap: 4px; background: #121c17; border: 1px solid #223229; border-radius: 8px; padding: 3px 6px; }
  .month-sel span { min-width: 76px; text-align: center; font-size: 13px; color: #bfe8d2; }
  .month-sel button { background: none; border: 0; color: #7ee2ae; cursor: pointer; font-size: 15px; padding: 2px 8px; border-radius: 5px; }
  .month-sel button:hover { background: #1c2c23; }
  .month-sel .today { font-size: 11px; color: #e0a24a; }
  .scen-pill { margin-left: auto; font-size: 10px; letter-spacing: .14em; padding: 4px 10px; border-radius: 20px; border: 1px solid #223229; color: #5f7a6d; }
  .scen-pill[data-on="true"] { border-color: #6e5730; color: #e0a24a; background: #211a0e; }

  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
  .span2 { grid-column: span 2; } .span3 { grid-column: span 3; }
  .stat-row { grid-column: span 3; display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 14px; }

  .card { background: #101a15; border: 1px solid #1c2a23; border-radius: 12px; padding: 16px 18px; min-width: 0; }
  .card-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 12px; }
  .card-head h3 { font-size: 12px; font-weight: 600; letter-spacing: .1em; text-transform: uppercase; color: #7d9c8c; }
  .acc-type { font-size: 9px; letter-spacing: .12em; color: #46c98c; margin-right: 8px; text-transform: uppercase; background: #14261d; padding: 2px 7px; border-radius: 4px; }

  .stat { background: #101a15; border: 1px solid #1c2a23; border-radius: 12px; padding: 14px 16px; }
  .stat.click { cursor: pointer; } .stat.click:hover { border-color: #2f8f63; }
  .stat-label { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #5f7a6d; margin-bottom: 6px; }
  .stat-value { font-size: 21px; font-weight: 600; color: #eafff4; }
  .stat-value.pos { color: #7ee2ae; } .stat-value.neg { color: #e0a24a; } .stat-value.warn { color: #f2b04d; }
  .stat-sub { font-size: 11px; color: #5f7a6d; margin-top: 4px; }

  .amt.pos { color: #7ee2ae; } .amt.neg { color: #e0a24a; } .amt.warn { color: #f2b04d; font-weight: 600; }
  .amt.muted-s { color: #5f7a6d; } .scen-amt { color: #e0a24a; }
  .warn-t { color: #f2b04d; }
  .muted { color: #7d9c8c; font-size: 13px; } .muted-s { color: #5f7a6d; font-size: 11.5px; }
  .empty { color: #5f7a6d; font-size: 13px; padding: 14px 4px; }
  .acc-bal { font-size: 24px; font-weight: 600; color: #eafff4; margin-bottom: 4px; }

  /* tables */
  .tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
  .tbl th { text-align: left; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #5f7a6d; padding: 6px 8px; border-bottom: 1px solid #1c2a23; font-weight: 600; }
  .tbl td { padding: 6px 8px; border-bottom: 1px solid #15211b; vertical-align: middle; }
  .tbl tr:hover td { background: #0f1a14; }
  .tbl .r, th.r { text-align: right; }
  .tbl tr.dim { opacity: .38; }
  .tbl tr.hl td { background: #10201780; }
  .scroll-y { overflow-y: auto; }

  .chip { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 10px; background: #182420; color: #7d9c8c; border: 1px solid #223229; letter-spacing: .03em; white-space: nowrap; }
  .chip.ok { background: #12291d; color: #7ee2ae; border-color: #235c40; }
  .chip.pending { background: #211d0e; color: #d9c26a; border-color: #55491f; }
  .chip.warn { background: #2a1c0d; color: #f2b04d; border-color: #6e5730; }
  .chip.transfer { background: #14202a; color: #7ab8e0; border-color: #29465c; }
  .chip.ghost { background: transparent; }
  .chip.click { cursor: pointer; }

  /* inputs */
  input, select { background: #0d1712; border: 1px solid #223229; color: #d7e5dd; border-radius: 6px; padding: 5px 8px; font: inherit; }
  input:focus, select:focus { outline: none; border-color: #2f8f63; }
  .cat-sel { max-width: 175px; font-size: 12px; }
  .cell-in { width: 100%; max-width: 170px; background: transparent; border-color: transparent; }
  .cell-in:hover, .cell-in:focus { border-color: #223229; background: #0d1712; }
  .cell-in.day { width: 54px; }
  .num-in { width: 110px; text-align: right; }
  .num-in.pct { width: 74px; }
  .filters { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .filters input { width: 170px; }
  .form { display: flex; flex-direction: column; gap: 10px; }
  .form.form-row { flex-direction: row; flex-wrap: wrap; gap: 16px; }
  .form label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #7d9c8c; letter-spacing: .04em; }
  .form label.chk, .switch { flex-direction: row; align-items: center; gap: 8px; font-size: 12px; color: #a9c4b6; cursor: pointer; display: flex; }
  .add-row { display: flex; gap: 8px; margin-top: 12px; padding-top: 12px; border-top: 1px dashed #1c2a23; flex-wrap: wrap; }
  .actions { display: flex; justify-content: space-between; margin-top: 14px; }
  .btn-col { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }

  .btn { background: #1c4a34; color: #baf3d6; border: 1px solid #2f8f63; border-radius: 7px; padding: 7px 16px; font: inherit; font-size: 13px; cursor: pointer; }
  .btn:hover { background: #235c40; } .btn:disabled { opacity: .4; cursor: default; }
  .btn.ghost { background: transparent; border-color: #223229; color: #7d9c8c; }
  .btn.ghost:hover { color: #d7e5dd; border-color: #2f8f63; }
  .mini { background: transparent; border: 1px solid transparent; color: #5f7a6d; border-radius: 5px; padding: 2px 7px; cursor: pointer; font-size: 12px; }
  .mini:hover { color: #7ee2ae; border-color: #223229; }

  .banner { grid-column: span 3; background: #0f2018; border: 1px solid #235c40; color: #a9d8bd; border-radius: 10px; padding: 10px 14px; font-size: 13px; margin-bottom: 12px; }
  .banner.warn { background: #211a0e; border-color: #6e5730; color: #e8c48a; }
  .callout { margin-top: 12px; padding: 10px 12px; border-left: 2px solid #2f8f63; background: #0e1a14; font-size: 12.5px; color: #a9c4b6; border-radius: 0 8px 8px 0; }

  /* drilldown bar rows */
  .bar-row { display: grid; grid-template-columns: 110px 1fr 92px; gap: 10px; align-items: center; width: 100%; background: none; border: 0; color: #a9c4b6; font: inherit; font-size: 12.5px; padding: 5px 2px; cursor: pointer; text-align: left; border-radius: 6px; }
  .bar-row:hover { background: #0f1a14; }
  .bar-row .r, .bar-row .amt { text-align: right; }
  .bar-track { height: 7px; background: #15211b; border-radius: 4px; overflow: hidden; }
  .bar-fill { display: block; height: 100%; background: linear-gradient(90deg, #2f8f63, #e0a24a); border-radius: 4px; }

  /* annual timeline */
  .timeline { display: grid; grid-template-columns: repeat(12, 1fr); gap: 6px; }
  .tl-month { background: #0d1712; border: 1px solid #1c2a23; border-radius: 8px; min-height: 84px; padding: 6px; }
  .tl-month.now { border-color: #2f8f63; }
  .tl-label { font-size: 10px; letter-spacing: .1em; color: #5f7a6d; margin-bottom: 5px; text-align: center; }
  .tl-item { font-size: 10px; line-height: 1.3; background: #211d0e; border: 1px solid #55491f; color: #d9c26a; border-radius: 6px; padding: 4px 5px; margin-bottom: 4px; }
  .tl-item.paid { background: #12291d; border-color: #235c40; color: #7ee2ae; }

  /* imports */
  .steps { display: flex; gap: 10px; }
  .step { flex: 1; display: flex; align-items: center; gap: 10px; padding: 10px 14px; background: #101a15; border: 1px solid #1c2a23; border-radius: 10px; color: #5f7a6d; font-size: 13px; }
  .step.on { border-color: #2f8f63; color: #baf3d6; }
  .step.done { color: #7d9c8c; }
  .step-n { width: 22px; height: 22px; border-radius: 50%; border: 1px solid currentColor; display: grid; place-items: center; font-size: 11px; flex: none; }
  .drop { border: 1.5px dashed #2b4033; border-radius: 12px; padding: 34px 20px; text-align: center; color: #a9c4b6; cursor: pointer; display: flex; flex-direction: column; gap: 8px; align-items: center; }
  .drop:hover { border-color: #2f8f63; background: #0e1a14; }
  .drop-ic { font-size: 26px; color: #46c98c; }

  /* scenario */
  .scen-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 8px; }
  .scen-grid[data-off="true"] { opacity: .35; pointer-events: none; }
  .scen-grid label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: #7d9c8c; }

  .recon { margin-top: 8px; border-top: 1px dashed #1c2a23; padding-top: 8px; display: flex; flex-direction: column; gap: 6px; }
  .recon-row { display: flex; gap: 8px; } .recon-row input { flex: 1; min-width: 0; }
  .recon-result { font-size: 12px; padding: 7px 10px; border-radius: 7px; }
  .recon-result.ok { background: #12291d; color: #7ee2ae; }
  .recon-result.bad { background: #2a1c0d; color: #e8c48a; }

  .tip { background: #0e1a14; border: 1px solid #235c40; border-radius: 8px; padding: 8px 11px; font-size: 12px; font-family: ui-monospace, Menlo, monospace; }
  .tip-t { color: #7d9c8c; margin-bottom: 4px; }

  @media (max-width: 1100px) {
    .grid { grid-template-columns: 1fr; }
    .span2, .span3, .stat-row, .banner { grid-column: span 1; }
    .nav { width: 64px; } .nav .brand-name, .nav .brand-sub, .nav-item { font-size: 0; }
    .nav-item .nav-ic { font-size: 15px; } .nav-foot, .nav-badge { display: none; }
    .timeline { grid-template-columns: repeat(4, 1fr); }
  }
`;
