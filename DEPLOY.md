# Deploying ReRoom (about 20 minutes)

The database (Supabase project `wueglazkbyvxaojsxpzw`) is already set up. Three things are left: the Google AI key, the AI function, and the website.

## 1 · Google AI key (5 min)

1. Go to **https://aistudio.google.com**, sign in with your Google account and click **Get API key → Create API key**. Copy it.
2. Your Google AI **Pro** subscription covers the Gemini *app*, not the *API*. These are billed separately. Image generation through the API usually needs billing turned on: in AI Studio, click **Set up billing** next to your key. Images cost a few cents each, so a full day of testing plus the demo is a few dollars.
   - If a makeover fails with "AI quota reached … limit: 0", that's the billing step.

## 2 · AI function in Supabase (5 min)

1. Supabase → **Edge Functions → Secrets** → add `GEMINI_API_KEY` = your key → Save.
2. **Edge Functions → Deploy a new function → Via Editor**. Name it exactly `generate-makeover`, delete the sample code, paste all of `supabase/functions/generate-makeover/index.ts`, and click **Deploy**.
3. Open the function → **Settings** (or Details) → turn **OFF** "Verify JWT" / "Enforce JWT verification" → Save. The function checks the user's login itself, and leaving this on can block real users on new Supabase projects.

Optional secrets: `GEMINI_IMAGE_MODEL` (default `gemini-3.1-flash-image`), `GEMINI_TEXT_MODEL` (default `gemini-3.8-flash`), `DAILY_LIMIT` (default 15).

## 3 · Website on Vercel (10 min)

1. Unzip the project to a folder (e.g. `C:\Dev\reroom`).
2. On github.com click **New repository** → name `reroom` → Private → Create. Then in a terminal inside the folder:
   ```
   git init
   git add .
   git commit -m "ReRoom MVP"
   git branch -M main
   git remote add origin https://github.com/YOUR-ACCOUNT/reroom.git
   git push -u origin main
   ```
3. **vercel.com → Add New → Project →** import `reroom`. Vercel detects Vite automatically.
4. Before clicking Deploy, open **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = `https://wueglazkbyvxaojsxpzw.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = your **publishable** key (`sb_publishable_…`). Never the secret key.
5. Click **Deploy**. You get a link like `reroom-xxxx.vercel.app`.
6. Supabase → **Authentication → URL Configuration** → set **Site URL** to that link → Save.

## 4 · Smoke test (5 min)

1. Open the live link → Create account → you land on New makeover with 4 style cards.
2. Upload a living-room photo → Boho → Light refresh → Generate. Wait 20–60 s.
3. Drag the slider, check the palette, click **Save to gallery**, then open **Gallery**.
4. If generation fails, the red box shows the reason. Supabase → Edge Functions → generate-makeover → **Logs** shows the details.

## Run it locally (optional)

```
npm install
copy .env.example .env.local     (then fill in the publishable key)
npm run dev
```
