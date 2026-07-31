/* ============================================================
   THEME — semantic design tokens for the dark ledger and a
   hand-authored light counterpart.

   The dark column is the palette the app has always shipped, so
   dark mode is unchanged. Light is not an inversion: the amber
   used for variance/negatives (#e0a24a) is unreadable on white,
   so light uses a burnt-sienna for `--neg` and a deep evergreen
   for the mint accent, both above 4.5:1 on the card surface.

   Recharts takes colours as JSX props, not CSS, so the same
   tokens are mirrored as hex in CHART below.
   ============================================================ */

export const THEME_KEY = "ledgerline.theme";

/** localStorage mirror of the preference — read before the network resolves. */
export const readStoredTheme = () => {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null; // private mode / storage disabled
  }
};

export const storeTheme = (theme) => {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* non-fatal */ }
};

export const applyTheme = (theme) => {
  document.documentElement.setAttribute("data-theme", theme);
};

/* Injected ahead of every stylesheet in the app (App, auth screen, shell bar)
   because only one of those trees is mounted at a time. */
export const THEME_CSS = `
  :root, :root[data-theme="dark"] {
    color-scheme: dark;
    --bg: #0b1210;
    --bg-translucent: #0b1210ee;
    --surface: #101a15;
    --surface-nav: #0e1714;
    --surface-bar: #0d1512;
    --surface-sunken: #0d1712;
    --surface-raised: #121c17;
    --surface-hover: #0f1a14;
    --surface-hover-nav: #142019;
    --surface-hover-strong: #1c2c23;
    --surface-active-nav: #16281f;
    --row-hl: #10201780;
    --chip-bg: #182420;
    --track: #15211b;
    --border: #1c2a23;
    --border-2: #1d2a24;
    --border-soft: #1a2621;
    --border-strong: #223229;
    --border-subtle: #15211b;

    --text: #d7e5dd;
    --text-strong: #eafff4;
    --text-soft: #a9c4b6;
    --text-label: #9db8ab;
    /* Raised so the small type they carry clears 4.5:1. --text-muted is the
       most-used token in the app — every <th>, every stat label, every caption
       — and at #5f7a6d it measured 3.80:1 on --surface and 4.05:1 on --bg.
       --text-faint at #43584d measured 2.38:1 in the sidebar footer, under even
       the 3:1 large-text floor. --text-muted-2 already passed at 5.93:1 and is
       lifted only to keep a visible step above the new --text-muted, so the
       four-tier grey ladder the palette is built on still reads as four tiers. */
    --text-muted: #7a9486;
    --text-muted-2: #8dab9c;
    --text-faint: #708a7c;
    --text-nav: #8ba899;

    --accent: #7ee2ae;
    --accent-strong: #46c98c;
    --accent-deep: #2f8f63;
    --accent-border: #235c40;
    --accent-bg: #12291d;
    --accent-bg-2: #12281d;
    --accent-bg-soft: #0e1a14;
    --accent-bg-badge: #1d3328;
    --accent-bg-chip: #14261d;
    --accent-bg-banner: #0f2018;
    --accent-text-soft: #a9d8bd;
    --accent-text-2: #bfe8d2;
    --on-accent: #06120c;
    --brand-grad-from: #123527;
    --brand-mark-text: #bff3d9;
    --btn-bg: #1c4a34;
    --btn-bg-hover: #235c40;
    --btn-text: #baf3d6;
    --step-on-text: #baf3d6;
    --drop-border: #2b4033;

    --pos: #7ee2ae;
    --neg: #e0a24a;
    --neg-bg: #211a0e;
    --neg-bg-2: #2a1a12;
    --neg-border: #6e5730;
    --neg-text-soft: #e8c48a;
    --warn: #f2b04d;
    --warn-bg: #2a1c0d;
    --warn-border: #6e5730;
    --demo-bg: #16130c;
    --pending: #d9c26a;
    --pending-bg: #211d0e;
    --pending-border: #55491f;
    --transfer: #7ab8e0;
    --transfer-bg: #14202a;
    --transfer-border: #29465c;
  }

  :root[data-theme="light"] {
    color-scheme: light;
    --bg: #f4f7f5;
    --bg-translucent: #f4f7f5e6;
    --surface: #ffffff;
    --surface-nav: #eef2ef;
    --surface-bar: #eef2ef;
    --surface-sunken: #f2f6f3;
    --surface-raised: #ffffff;
    --surface-hover: #eef3f0;
    --surface-hover-nav: #e3eae5;
    --surface-hover-strong: #dcefe4;
    --surface-active-nav: #dcefe4;
    --row-hl: #e9f4ee;
    --chip-bg: #eef2ef;
    --track: #dfe7e2;
    --border: #d3ded7;
    --border-2: #d3ded7;
    --border-soft: #dde6e0;
    --border-strong: #bccdc3;
    --border-subtle: #e6ece8;

    --text: #1b2b23;
    --text-strong: #0d1a14;
    --text-soft: #33463d;
    --text-label: #445a4e;
    --text-muted: #5a6f64;
    --text-muted-2: #4a5f54;
    /* The one light pair that missed: 4.49:1 on --surface-nav, i.e. the sidebar
       footer, short of 4.5 by a rounding error. Everything else in this column
       passes on the pairs that actually occur, so nothing else moves. */
    --text-faint: #5c7065;
    --text-nav: #3d5147;

    --accent: #16794f;
    --accent-strong: #0f6b45;
    --accent-deep: #0d5c3b;
    --accent-border: #9ecfb6;
    --accent-bg: #e3f3ea;
    --accent-bg-2: #e3f3ea;
    --accent-bg-soft: #eef7f2;
    --accent-bg-badge: #ddf0e6;
    --accent-bg-chip: #eaf7f0;
    --accent-bg-banner: #edf7f1;
    --accent-text-soft: #14523a;
    --accent-text-2: #1b2b23;
    --on-accent: #ffffff;
    --brand-grad-from: #2aa06b;
    --brand-mark-text: #ffffff;
    --btn-bg: #16794f;
    --btn-bg-hover: #0f6340;
    --btn-text: #ffffff;
    --step-on-text: #0f6b45;
    --drop-border: #a8c4b5;

    --pos: #16794f;
    --neg: #a8442a;
    --neg-bg: #fbeee9;
    --neg-bg-2: #fbeee9;
    --neg-border: #e2b4a8;
    --neg-text-soft: #8a3a24;
    --warn: #9a6206;
    --warn-bg: #fdf3e2;
    --warn-border: #e0c184;
    --demo-bg: #fdf3e2;
    --pending: #7a5c12;
    --pending-bg: #faf1dc;
    --pending-border: #e3cf9d;
    --transfer: #1d6a9e;
    --transfer-bg: #e8f2f9;
    --transfer-border: #a9cbe3;
  }
`;

/* Recharts colours arrive as JSX props (stroke, fill, tick.fill, stopColor),
   which CSS custom properties cannot reach — hence a JS mirror of the tokens. */
export const CHART = {
  dark: {
    grid: "#1d2a24",
    /* 11px tick labels, so they answer to 4.5:1 like any other small text:
       #5f7a6d measured 3.80:1 on the card they sit on. Mirrors --text-muted. */
    axis: "#7a9486",
    zero: "#33463d",
    pos: "#46c98c",
    neg: "#e0a24a",
    posPlan: "#2a5c46",
    negPlan: "#6e5730",
    line: "#8fe6bd",
    marker: "#e0a24a",
    nwLine: "#eafff4",
    cash: "#1f4d38",
    invest: "#2f8f63",
    crypto: "#57c491",
    property: "#28402f",
    mortgage: "#5c3c22",
    /* Card colour, used as the gap in the diagonal hatch that marks money-out
       bars — see ChartHatch in App.jsx. Sign has to survive being printed in
       grey and being seen by someone who cannot separate the two hues. */
    stripe: "#101a15",
  },
  light: {
    grid: "#dde6e0",
    axis: "#5a6f64",
    zero: "#bccdc3",
    pos: "#16794f",
    neg: "#a8442a",
    /* Plan months stay subordinate to actuals, but not so pale that the
       tooltip — which colours its text with the series colour — washes out. */
    posPlan: "#6cb896",
    negPlan: "#d19a86",
    line: "#0f6b45",
    marker: "#a8442a",
    nwLine: "#14231c",
    cash: "#5fb18b",
    invest: "#2f8f63",
    crypto: "#93d2b3",
    property: "#9bb5a7",
    mortgage: "#c0714f",
    /* In this column `pos` and `neg` measure 1.10:1 against one another — one
       flat grey to a deuteranope — so the hatch is what actually carries the
       sign here, not the hue. */
    stripe: "#ffffff",
  },
};
