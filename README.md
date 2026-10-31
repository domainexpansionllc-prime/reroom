# ReRoom

**See your living room in a new style before you spend a cent.**

Upload a photo of your actual living room, pick one of four styles (Modern, Traditional, Boho, Mediterranean), and ReRoom restyles that same room with AI, keeping your walls, windows and camera angle. Compare before and after with a slider, get a 60-30-10 colour palette and a "change this first" list, and save the ones you like to your gallery.

Vibe Coding Hackathon · AI Interior Makeover · Group 54

## How it works

```
Browser (React)                    Supabase                              Google Gemini
──────────────                     ────────                              ─────────────
Sign up / sign in  ───────────────▶ Auth (email + password)
Upload photo       ───────────────▶ Storage: {user}/originals/{room}.jpg
                                    rooms row
"Generate"         ─ room, style ─▶ Edge function generate-makeover
                                      checks login + daily limit
                                      downloads the photo          ────▶ Nano Banana (image edit)
                                                                   ────▶ Gemini Flash (palette + tips, JSON)
                                      saves image to Storage
                                      makeovers row → done
Result page        ◀── signed URLs ─  before + after images
```

- **The AI key never reaches the browser.** It lives only in the edge function's secrets.
- **Row-level security:** every user sees only their own rooms, makeovers and photos. 14 automated checks are in `supabase/test-rls.sql`.
- **Guardrails:** users choose from a fixed menu (no free-text prompts), the prompt locks the room's architecture, the palette call rejects photos that aren't living rooms, and there's a daily generation limit that deleting rows can't reset.

## Stack

React 18 + TypeScript + Vite + Tailwind · Supabase (Postgres, Auth, Storage, Edge Functions) · Gemini `gemini-2.5-flash-image` + `gemini-2.5-flash` · Vercel

## Project layout

```
src/                         front end
  pages/                     AuthPage, NewMakeover, MakeoverPage, Gallery
  components/                CompareSlider, PlanPanel, Layout, ui
  lib/                       supabase client, auth, api, image resize
supabase/
  schema.sql                 tables, RLS, storage, limit functions
  test-rls.sql               security test (14 checks)
  functions/generate-makeover/index.ts
  tools/auth-test.html       backend test page
DEPLOY.md                    setup and deployment steps
```
