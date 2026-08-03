import { afterEach } from "vitest";

/* ============================================================
   What a *.dom.test.jsx file needs before it can look at anything.

   vite.config.js hands a jsdom to any file named *.dom.test.jsx and leaves
   every other suite in node, but setupFiles has no such switch: this module is
   loaded before all of them, the two hundred and ten arithmetic tests
   included. So it asks whether there is a document before it does anything,
   and in node it is an import and nothing else — no ResizeObserver on a global
   that has no DOM to observe, and no react-dom pulled into a suite that parses
   money.
   ============================================================ */
if (typeof document !== "undefined") {
  /* jsdom is a document, not a browser: it lays nothing out and it has no
     ResizeObserver. Recharts' ResponsiveContainer asks for one in an effect the
     moment a chart mounts, and the Overview page the app opens on has three, so
     without this the whole tree unmounts itself with "ResizeObserver is not
     defined" before a single query runs. Observing nothing is the honest stub:
     nothing here has a size to report. */
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }

  /* Testing Library only tidies up after itself when the runner's hooks are
     globals. This project imports its hooks by name, so the unmount is ours to
     ask for — without it the second render lands in a document that still has
     the first one in it, and every query finds two of everything. Imported here
     rather than at the top of the file so that a node suite never loads
     react-dom at all. */
  const { cleanup } = await import("@testing-library/react");
  afterEach(cleanup);
}
