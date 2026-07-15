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

## Notes

- **Data model**: state is held as relational tables in memory (accounts, transactions, categories, rules, annual items, compensation, mortgage, batches, snapshots, audit) and persisted as one JSONB document per user with a debounced autosave. Migrating to fully normalised tables later doesn't require app changes beyond the load/save layer in `src/main.jsx`.
- **Money** is stored as integer cents everywhere.
- **Security**: never put the `service_role` key in this app — only the anon key.
- **PDF imports** are intentionally disabled in the client; they need a server-side parser (a good candidate for a Supabase Edge Function later).
