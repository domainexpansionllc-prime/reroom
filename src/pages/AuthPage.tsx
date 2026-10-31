import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { supabase, configError } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { fetchStyles, type Style } from "../lib/api";
import { Button, ErrorBox, SwatchStrip } from "../components/ui";
import { Logo } from "../components/Layout";

export default function AuthPage() {
  const { user, loading } = useAuth();
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(configError);
  const [notice, setNotice] = useState<string | null>(null);
  const [styles, setStyles] = useState<Style[]>([]);

  useEffect(() => {
    if (!configError) fetchStyles().then(setStyles).catch(() => {});
  }, []);

  if (!loading && user) return <Navigate to="/new" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const creds = { email: email.trim(), password };
    const { data, error } =
      mode === "signup" ? await supabase.auth.signUp(creds) : await supabase.auth.signInWithPassword(creds);
    setBusy(false);
    if (error) {
      setError(
        error.message === "Invalid login credentials" ? "That email and password don't match. Try again or sign up." : error.message,
      );
    } else if (mode === "signup" && !data.session) {
      setNotice("Check your email to confirm your account, then sign in.");
    }
  }

  return (
    <div className="min-h-screen bg-paper">
      <header className="mx-auto flex max-w-6xl items-center px-4 py-5">
        <Logo />
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-4 pb-20 pt-6 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:pt-12">
        <section>
          <p className="mb-4 inline-block rounded-full bg-moss-light px-3 py-1 text-xs font-semibold uppercase tracking-wider text-moss">
            AI living-room makeovers
          </p>
          <h1 className="font-serif text-4xl font-semibold leading-tight text-ink sm:text-5xl">
            See your living room in a new style before you spend a cent.
          </h1>
          <p className="mt-5 max-w-xl text-lg text-muted">
            Upload a photo of your actual living room, pick a style, and ReRoom restyles it while keeping your walls,
            windows and layout. You also get a colour palette and a "change this first" list.
          </p>

          <ol className="mt-8 grid max-w-xl gap-3 sm:grid-cols-3">
            {["Upload a photo", "Pick a style", "Compare & save"].map((s, i) => (
              <li key={s} className="rounded-2xl border border-line bg-white p-4">
                <span className="font-serif text-2xl font-semibold text-moss">{i + 1}</span>
                <p className="mt-1 text-sm font-medium text-ink">{s}</p>
              </li>
            ))}
          </ol>

          {styles.length > 0 && (
            <div className="mt-8 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
              {styles.map((s) => (
                <div key={s.slug} className="rounded-2xl border border-line bg-white p-3">
                  <SwatchStrip colors={s.swatches} className="h-8 rounded-lg" />
                  <p className="mt-2 text-sm font-medium text-ink">{s.name}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-line bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6 flex rounded-full bg-sand p-1" role="tablist">
            {(["signup", "signin"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setError(configError);
                  setNotice(null);
                }}
                className={`flex-1 rounded-full py-2 text-sm font-medium transition ${mode === m ? "bg-white text-moss shadow-sm" : "text-muted"}`}
              >
                {m === "signup" ? "Create account" : "Sign in"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-line bg-paper px-4 py-3 outline-none focus:border-moss"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-ink">Password</span>
              <input
                type="password"
                required
                minLength={6}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-line bg-paper px-4 py-3 outline-none focus:border-moss"
              />
              {mode === "signup" && <span className="mt-1 block text-xs text-muted">At least 6 characters.</span>}
            </label>

            {error && <ErrorBox>{error}</ErrorBox>}
            {notice && <p className="rounded-2xl bg-moss-light px-4 py-3 text-sm text-moss">{notice}</p>}

            <Button type="submit" disabled={busy || !!configError} className="w-full py-3">
              {busy ? "One moment…" : mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>
        </section>
      </main>
    </div>
  );
}
