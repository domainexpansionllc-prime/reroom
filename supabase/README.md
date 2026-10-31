# ReRoom backend contract

Owner: P3 (Backend Lead). **Scope: living room only. Styles: Modern, Traditional, Boho, Mediterranean.**

The schema is already live in Supabase. Front end (P2/Bolt) and edge function (P4) build against this contract. **Bolt must not create or change tables.** If you need a column, ask P3.

## Connection (front end)

| What | Where |
|---|---|
| Project URL + **publishable** key (called "anon" on older projects) | Supabase → Project Settings → API Keys. Safe in the front end. |
| **secret** key (called "service_role" on older projects) | Edge function secrets ONLY. Never in Bolt, never in GitHub. |

## Auth: email + password (Supabase Auth)

```ts
await supabase.auth.signUp({ email, password })              // "Confirm email" is OFF, so this returns a session
await supabase.auth.signInWithPassword({ email, password })
await supabase.auth.signOut()
supabase.auth.onAuthStateChange((_e, session) => { /* session?.user ?? null → route guard */ })
```
Signed-out users can only see the landing page and read `styles`.

## Tables

**styles** (read-only; render the style cards from this, ordered by `sort_order`)
`slug` · `name` · `tagline` · `swatches text[3]` · `prompt_desc` (for P4) · `preview_path`

| slug (store this) | name (show this) |
|---|---|
| `modern` | Modern |
| `traditional` | Traditional |
| `boho` | Boho |
| `mediterranean` | Mediterranean |

**rooms** (browser: full CRUD on its own rows)
`id` · `user_id` (defaults to the signed-in user, so don't send it) · `title` (default "Living room") · `room_type` (always `living_room`, so don't send it) · `original_path` · `created_at`

**makeovers** (browser: read, delete, and update **`is_saved` only**; the edge function creates them)
`id` · `room_id` · `user_id` · `style` · `refresh_level` (`light`|`full`, default `light`) · `status` (`generating`|`done`|`failed`) · `error` · `image_path` · `palette` · `tips` · `is_saved` · `prompt` · `created_at`

Gallery query: `from('makeovers').select('*').eq('is_saved', true).order('created_at', { ascending: false })`

## Storage: private bucket `rooms`

| Path | Who writes it |
|---|---|
| `{user_id}/originals/{room_id}.jpg` | Browser (JPG/PNG/WebP, max 10 MB) |
| `{user_id}/makeovers/{makeover_id}.png` | Edge function only |

Show images with `createSignedUrl(path, 3600)`. Never use public URLs.

**Upload flow:** `const id = crypto.randomUUID()` → upload to `${user.id}/originals/${id}.jpg` → `insert({ id, original_path })` into rooms → call the edge function.

**Delete room:** remove its files first (original + its makeovers' `image_path`s) with `storage.remove([...])`, then delete the row. Deleting rows does not delete files.

## Edge function `generate-makeover` (P4)

Deployed separately by P4 (Bolt may not see it until then). Browser calls: `supabase.functions.invoke('generate-makeover', { body: { room_id, style, refresh_level } })`

Inside the function (service-role client):
1. Get the user from the `Authorization` header (`supabase.auth.getUser(jwt)`); reject if missing.
2. `rpc('claim_generation', { p_user_id: user.id, p_daily_limit: 15 })`. If it returns `false`, send back "Daily limit reached".
3. Check that the room belongs to the user, read `styles.prompt_desc` for the prompt, insert the makeover with `status='generating'` → … → `done` / `failed`.

Front end can show the remaining count with `rpc('my_generations_left')`.

## Testing
- `schema.sql`: run once in the SQL Editor (it's safe to re-run).
- `test-rls.sql`: paste two real user UIDs and run it. It should return `ALL 14 RLS CHECKS PASSED`.
- `tools/auth-test.html`: open it in Chrome and test sign-up, sign-in, upload and cross-user privacy, with no front end needed.
