import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  deleteMakeover,
  fetchStyles,
  generateMakeover,
  GenerateError,
  getMakeover,
  getRoom,
  setSaved,
  signedUrls,
  styleName,
  type Makeover,
  type Room,
  type Style,
} from "../lib/api";
import CompareSlider from "../components/CompareSlider";
import PlanPanel from "../components/PlanPanel";
import { Button, ErrorBox, PageLoader, Spinner, formatDate } from "../components/ui";

export default function MakeoverPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [m, setM] = useState<Makeover | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [styles, setStyles] = useState<Style[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "save" | "delete" | "regen">(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [mk, st] = await Promise.all([getMakeover(id!), fetchStyles()]);
        if (!mk) throw new Error("This makeover doesn't exist or was deleted.");
        const rm = await getRoom(mk.room_id);
        const paths = [rm?.original_path, mk.image_path].filter((p): p is string => !!p);
        const u = paths.length ? await signedUrls(paths) : {};
        if (!alive) return;
        setM(mk);
        setRoom(rm);
        setStyles(st);
        setUrls(u);
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  async function toggleSave() {
    if (!m) return;
    setBusy("save");
    try {
      await setSaved(m.id, !m.is_saved);
      setM({ ...m, is_saved: !m.is_saved });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!m || !confirm("Delete this makeover permanently?")) return;
    setBusy("delete");
    try {
      await deleteMakeover(m);
      navigate(m.is_saved ? "/gallery" : "/new");
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  async function regenerate() {
    if (!m) return;
    setBusy("regen");
    setError(null);
    try {
      const next = await generateMakeover(m.room_id, m.style, m.refresh_level);
      navigate(`/makeover/${next.id}`);
    } catch (e) {
      setError((e as GenerateError).message);
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <PageLoader />;
  if (!m) return <ErrorBox>{error ?? "Makeover not found."}</ErrorBox>;

  const name = styleName(styles, m.style);
  const before = room ? urls[room.original_path] : undefined;
  const after = m.image_path ? urls[m.image_path] : undefined;
  const tryAnother = `/new?room=${m.room_id}&refresh=${m.refresh_level}`;

  if (busy === "regen") {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="relative overflow-hidden rounded-3xl bg-sand">
          {before ? <img src={before} alt="Your living room" className="w-full opacity-40" /> : <div className="aspect-[4/3]" />}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-center">
            <Spinner className="h-10 w-10 text-moss" />
            <p className="font-serif text-2xl font-semibold text-ink">Restyling your room again…</p>
            <p className="text-muted">This takes 30–90 seconds</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr]">
      <div className="space-y-4">
        {m.status === "done" && before && after ? (
          <CompareSlider before={before} after={after} alt={`${room?.title ?? "Living room"} in ${name} style`} />
        ) : m.status === "failed" ? (
          <div className="space-y-4">
            {before && <img src={before} alt="Your living room" className="w-full rounded-3xl opacity-60" />}
            <ErrorBox>
              <p>{m.error ?? "This makeover failed."}</p>
              <button onClick={regenerate} className="mt-2 font-semibold underline">
                Try again
              </button>
            </ErrorBox>
          </div>
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center rounded-3xl bg-sand text-muted">Still generating… refresh in a moment.</div>
        )}
        {m.status === "done" && <p className="text-center text-sm text-muted">Drag the handle to compare before and after.</p>}
      </div>

      <aside className="space-y-6">
        <div>
          <p className="text-sm text-muted">
            {room?.title ?? "Living room"} · {formatDate(m.created_at)}
          </p>
          <h1 className="font-serif text-3xl font-semibold text-ink">{name}</h1>
          <p className="mt-1 text-sm text-muted">{m.refresh_level === "light" ? "Light refresh: furniture kept" : "Full makeover"}</p>
        </div>

        {error && <ErrorBox>{error}</ErrorBox>}

        {m.status === "done" && (
          <div className="flex flex-wrap gap-2">
            <Button onClick={toggleSave} disabled={!!busy} variant={m.is_saved ? "ghost" : "primary"}>
              {busy === "save" ? <Spinner className="h-4 w-4" /> : null}
              {m.is_saved ? "Remove from gallery" : "Save to gallery"}
            </Button>
            <Button variant="ghost" onClick={() => navigate(tryAnother)} disabled={!!busy}>
              Try another style
            </Button>
            <Button variant="ghost" onClick={regenerate} disabled={!!busy}>
              Regenerate
            </Button>
          </div>
        )}

        <PlanPanel palette={m.palette} tips={m.tips} />

        <div className="flex items-center justify-between border-t border-line pt-4 text-sm">
          <Link to={m.is_saved ? "/gallery" : "/new"} className="text-muted hover:text-ink">
            ← Back
          </Link>
          <button onClick={remove} disabled={!!busy} className="text-muted hover:text-danger">
            {busy === "delete" ? "Deleting…" : "Delete makeover"}
          </button>
        </div>
      </aside>
    </div>
  );
}
