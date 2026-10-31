import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import {
  deleteRoom,
  fetchStyles,
  generateMakeover,
  GenerateError,
  generationsLeft,
  listRooms,
  renameRoom,
  signedUrls,
  uploadRoom,
  type Room,
  type Style,
} from "../lib/api";
import { Button, ErrorBox, PageLoader, SectionTitle, Spinner, SwatchStrip } from "../components/ui";

const TIPS = [
  "Paint and textiles change a room the most for the least money.",
  "The 60-30-10 rule: 60% main colour, 30% secondary, 10% accent.",
  "Keeping your sofa? Restyle it with new cushions and a throw.",
  "Warm bulbs (2700K) make any style feel more inviting.",
];

type Phase = "idle" | "uploading" | "generating";

export default function NewMakeover() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [styles, setStyles] = useState<Style[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [roomId, setRoomId] = useState<string | null>(params.get("room"));
  const [style, setStyle] = useState<string | null>(params.get("style"));
  const [refresh, setRefresh] = useState<"light" | "full">(params.get("refresh") === "full" ? "full" : "light");
  const [left, setLeft] = useState<number | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<{ message: string; retry: boolean } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [genPreview, setGenPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const top = useRef<HTMLDivElement>(null);

  const loadRooms = useCallback(async () => {
    const r = await listRooms();
    setRooms(r);
    if (r.length) setThumbs(await signedUrls(r.map((x) => x.original_path)).catch(() => ({})));
    return r;
  }, []);

  useEffect(() => {
    Promise.all([fetchStyles(), loadRooms(), generationsLeft()])
      .then(([s, , l]) => {
        setStyles(s);
        setLeft(l);
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [loadRooms]);

  useEffect(() => {
    if (phase !== "generating") return;
    setElapsed(0);
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [phase]);

  useEffect(() => () => void (filePreview && URL.revokeObjectURL(filePreview)), [filePreview]);

  function pickFile(f: File | undefined) {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setError({ message: "Please choose a JPG, PNG or WebP photo.", retry: false });
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError({ message: "That photo is over 10 MB. Please choose a smaller one.", retry: false });
      return;
    }
    setError(null);
    setFile(f);
    setFilePreview(URL.createObjectURL(f));
    setRoomId(null);
  }

  const selectedRoom = rooms.find((r) => r.id === roomId) ?? null;
  const previewSrc = filePreview ?? (selectedRoom ? thumbs[selectedRoom.original_path] : null);
  const canGenerate = !!(file || selectedRoom) && !!style && phase === "idle" && left !== 0;

  async function generate() {
    if (!user || !style) return;
    setError(null);
    setGenPreview(previewSrc);
    top.current?.scrollIntoView({ behavior: "smooth" });
    try {
      let room = selectedRoom;
      if (file) {
        setPhase("uploading");
        room = await uploadRoom(file, user.id);
        const uploaded = room;
        setRooms((prev) => [uploaded, ...prev]);
        setFile(null);
        setRoomId(uploaded.id);
        signedUrls([uploaded.original_path]).then((u) => setThumbs((t) => ({ ...t, ...u }))).catch(() => {});
      }
      if (!room) return;
      setPhase("generating");
      const m = await generateMakeover(room.id, style, refresh);
      navigate(`/makeover/${m.id}`);
    } catch (e) {
      const ge = e as GenerateError;
      const isLimit = ge.code === "limit";
      setError({ message: ge.message, retry: !isLimit });
      generationsLeft().then(setLeft);
      setPhase("idle");
    }
  }

  async function removeRoom(r: Room) {
    if (!confirm(`Delete "${r.title}" and all its makeovers?`)) return;
    try {
      await deleteRoom(r);
      if (roomId === r.id) setRoomId(null);
      await loadRooms();
    } catch (e) {
      setError({ message: (e as Error).message, retry: false });
    }
  }

  async function saveRename() {
    if (!renaming) return;
    try {
      await renameRoom(renaming.id, renaming.title);
      setRenaming(null);
      await loadRooms();
    } catch (e) {
      setError({ message: (e as Error).message, retry: false });
    }
  }

  if (loading) return <PageLoader />;
  if (loadError) return <ErrorBox>{loadError}</ErrorBox>;

  // ---------- Generating view ----------
  if (phase !== "idle") {
    return (
      <div ref={top} className="mx-auto max-w-3xl">
        <div className="relative overflow-hidden rounded-3xl bg-sand">
          {genPreview ? (
            <img src={genPreview} alt="Your living room" className="w-full opacity-40 blur-[1px]" />
          ) : (
            <div className="aspect-[4/3] w-full" />
          )}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
            <Spinner className="h-10 w-10 text-moss" />
            <p className="font-serif text-2xl font-semibold text-ink">
              {phase === "uploading" ? "Uploading your photo…" : "Restyling your room…"}
            </p>
            {phase === "generating" && (
              <p className="text-muted">This takes 20–60 seconds · {elapsed}s</p>
            )}
          </div>
        </div>
        <p className="mt-6 rounded-2xl border border-line bg-white p-4 text-center text-sm text-muted">
          <span className="font-semibold text-moss">Tip: </span>
          {TIPS[Math.floor(elapsed / 8) % TIPS.length]}
        </p>
      </div>
    );
  }

  // ---------- Form ----------
  return (
    <div ref={top} className="grid gap-10 lg:grid-cols-[1fr_1fr]">
      <div className="space-y-10">
        <section>
          <SectionTitle title="Your living room" sub="Upload a photo taken from a corner or doorway so most of the room is visible." />
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFile(e.dataTransfer.files[0]);
            }}
            onClick={() => fileInput.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
            className={`relative flex min-h-[260px] cursor-pointer items-center justify-center overflow-hidden rounded-3xl border-2 border-dashed transition ${
              dragOver ? "border-moss bg-moss-light" : "border-line bg-white hover:border-moss"
            }`}
          >
            {previewSrc ? (
              <>
                <img src={previewSrc} alt="Selected living room" className="max-h-[420px] w-full object-cover" />
                <span className="absolute bottom-3 right-3 rounded-full bg-white/90 px-3 py-1 text-xs font-medium text-ink shadow">
                  Change photo
                </span>
              </>
            ) : (
              <div className="p-8 text-center">
                <svg className="mx-auto mb-3 h-10 w-10 text-moss" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <rect x="3" y="4" width="18" height="16" rx="3" />
                  <circle cx="9" cy="10" r="2" />
                  <path d="M21 16l-5-5-9 9" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <p className="font-medium text-ink">Drop a photo here or click to upload</p>
                <p className="mt-1 text-sm text-muted">JPG, PNG or WebP · up to 10 MB</p>
              </div>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                pickFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
        </section>

        {rooms.length > 0 && (
          <section>
            <SectionTitle title="Your rooms" sub="Restyle a room you've already uploaded without sending the photo again." />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {rooms.map((r) => {
                const active = r.id === roomId && !file;
                return (
                  <li key={r.id} className={`overflow-hidden rounded-2xl border-2 bg-white transition ${active ? "border-moss" : "border-transparent"}`}>
                    <button
                      className="block w-full"
                      onClick={() => {
                        setRoomId(r.id);
                        setFile(null);
                        setFilePreview(null);
                        setError(null);
                      }}
                      aria-pressed={active}
                    >
                      {thumbs[r.original_path] ? (
                        <img src={thumbs[r.original_path]} alt={r.title} className="aspect-[4/3] w-full object-cover" />
                      ) : (
                        <div className="aspect-[4/3] w-full bg-sand" />
                      )}
                    </button>
                    <div className="p-2">
                      {renaming?.id === r.id ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            saveRename();
                          }}
                          className="flex gap-1"
                        >
                          <input
                            autoFocus
                            value={renaming.title}
                            onChange={(e) => setRenaming({ id: r.id, title: e.target.value })}
                            className="min-w-0 flex-1 rounded-lg border border-line px-2 py-1 text-sm"
                            maxLength={60}
                          />
                          <button className="text-xs font-medium text-moss">Save</button>
                        </form>
                      ) : (
                        <>
                          <p className="truncate text-sm font-medium text-ink">{r.title}</p>
                          <div className="mt-1 flex gap-3 text-xs">
                            <button className="text-muted hover:text-moss" onClick={() => setRenaming({ id: r.id, title: r.title })}>
                              Rename
                            </button>
                            <button className="text-muted hover:text-danger" onClick={() => removeRoom(r)}>
                              Delete
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <div className="space-y-10 lg:sticky lg:top-24 lg:self-start">
        <section>
          <SectionTitle title="Choose a style" sub="Pick the look you want to see in your room." />
          <div className="grid grid-cols-2 gap-3">
            {styles.map((s) => {
              const active = style === s.slug;
              return (
                <button
                  key={s.slug}
                  onClick={() => setStyle(s.slug)}
                  aria-pressed={active}
                  className={`rounded-2xl border-2 bg-white p-4 text-left transition ${active ? "border-moss shadow-sm" : "border-line hover:border-moss/50"}`}
                >
                  <SwatchStrip colors={s.swatches} className="h-10 rounded-xl" />
                  <p className="mt-3 font-serif text-lg font-semibold text-ink">{s.name}</p>
                  <p className="text-sm text-muted">{s.tagline}</p>
                </button>
              );
            })}
          </div>
        </section>

        <section>
          <SectionTitle title="How much should change?" />
          <div className="flex rounded-full bg-sand p-1" role="radiogroup">
            {(
              [
                ["light", "Light refresh – keep my furniture"],
                ["full", "Full makeover"],
              ] as const
            ).map(([val, label]) => (
              <button
                key={val}
                role="radio"
                aria-checked={refresh === val}
                onClick={() => setRefresh(val)}
                className={`flex-1 rounded-full px-3 py-2.5 text-sm font-medium transition ${refresh === val ? "bg-white text-moss shadow-sm" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          {error && (
            <ErrorBox>
              <p>{error.message}</p>
              {error.retry && (file || selectedRoom) && style && (
                <button onClick={generate} className="mt-2 font-semibold underline">
                  Try again
                </button>
              )}
            </ErrorBox>
          )}
          <Button onClick={generate} disabled={!canGenerate} className="w-full py-3.5 text-base">
            Generate makeover
          </Button>
          <p className="text-center text-sm text-muted">
            {!file && !selectedRoom
              ? "Upload a photo or pick one of your rooms to start."
              : !style
                ? "Now choose a style."
                : left === 0
                  ? "You've used today's makeovers. Come back tomorrow."
                  : left !== null
                    ? `${left} makeover${left === 1 ? "" : "s"} left today`
                    : null}
          </p>
        </section>
      </div>
    </div>
  );
}
