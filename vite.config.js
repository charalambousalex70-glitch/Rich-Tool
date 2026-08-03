import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    /* Node stays the default. The suites that were here first are pure
       functions — money parsing, forecasts, the Supabase stub — and none of
       them wants a document; giving them one would cost every run a jsdom
       and change nothing they assert.

       A component test does want one, and says so by its name: anything
       called *.dom.test.jsx is handed a jsdom instead. Naming the rule here
       rather than in a docblock at the top of each file means the next
       component suite gets a DOM by being called the right thing, and an
       existing suite cannot wander into one by accident. */
    environment: "node",
    environmentMatchGlobs: [["src/**/*.dom.test.jsx", "jsdom"]],
    include: ["src/**/*.test.{js,jsx}"],
    /* The ResizeObserver stub and the unmount after every test were written
       inline in the first DOM suite; they belong to every DOM suite there will
       ever be, so they live in one file now. setupFiles takes no glob, so this
       runs ahead of the node suites as well — it looks for a document before it
       does anything, and in node it is an import and nothing else. */
    setupFiles: ["./src/dom-setup.js"],
  },
});
