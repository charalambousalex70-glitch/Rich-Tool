# LEDGERLINE

A multi-user personal finance web app: statement imports (CSV / XLSX / OFX / QFX), rule-based categorisation with staged review, recurring and annual budget matching with variance flags, mortgage and compensation modelling, a 12-month forecast with scenario overlays, and a long-term net-worth projection to your planning age.

Each user signs in with email + password and gets their own private data (enforced by Postgres row-level security). Every change autosaves. Without Supabase configured, the app runs in demo mode — fully functional, in-memory only.

## 1. Run it locally

```bash
npm install
npm run dev        # opens on http://localhost:5173 in demo mode
```

## 2. Set up Supabase (free tier is fine)

1. Create a project at https://supabase.com.
2. In the SQL editor, paste and run `supabase/schema.sql`.
3. Authentication → Providers → make sure **Email** is enabled.
   (Optional: turn off "Confirm email" while testing so sign-ups work instantly.)
4. Settings → API: copy the **Project URL** and **anon public key**.
5. Copy `.env.example` to `.env` and fill both values in.
6. Restart `npm run dev` — you'll now see the sign-in screen.

## 3. Deploy it for other users

The app is a static single-page build; any static host works. The two easiest:

**Vercel** — push this folder to a GitHub repo, import it at https://vercel.com/new (framework auto-detected as Vite), and add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as environment variables in the project settings. Every push redeploys.

**Netlify** — same flow at https://app.netlify.com: build command `npm run build`, publish directory `dist`, plus the same two environment variables.

Then, in Supabase → Authentication → URL Configuration, set your deployed URL as the **Site URL** so confirmation/redirect emails point to the right place.

That's it — share the URL and anyone can create an account. The anon key is safe to expose in the client; row-level security means users can only ever read and write their own row.

## Continuous integration

`.github/workflows/ci.yml` runs on every push and every pull request, on Node 22: `npm ci`, then `npm test`, then `npm run build`. If any of the three fails, the run is red.

It ends with `npm run check:env`, which only reports — it never fails the run. Read it, because what it reports is easy to miss: **without `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` the build still succeeds.** The Supabase client isn't merely idle in that case, it is tree-shaken out of the bundle altogether, so a perfectly green build can be an app that signs nobody in and saves nothing. That is what you want locally and in the tests; it is not what you want on a URL you have given to other people. CI has no Supabase variables of its own, so its check will normally say demo mode — nothing is deployed from CI. Set both variables in Vercel or Netlify, and redeploy after you add them.

If you want a hard gate in a deploy pipeline, `node scripts/check-env.mjs --require` exits non-zero when either variable is missing. `npm run check:env -- --help` explains the rest. Neither changes how the app behaves at runtime.

## Notes

- **Data model**: state is held as relational tables in memory (accounts, transactions, categories, rules, annual items, compensation, mortgage, batches, snapshots, audit) and persisted as one JSONB document per user with a debounced autosave. Migrating to fully normalised tables later doesn't require app changes beyond the load/save layer in `src/main.jsx`.
- **Money** is stored as integer cents everywhere.
- **Security**: never put the `service_role` key in this app — only the anon key.
- **PDF imports** are intentionally disabled in the client; they need a server-side parser (a good candidate for a Supabase Edge Function later).
