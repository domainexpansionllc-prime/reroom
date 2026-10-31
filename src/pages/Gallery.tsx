import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fetchStyles, listGallery, signedUrls, styleName, type Makeover, type Style } from "../lib/api";
import { Button, ErrorBox, PageLoader, SectionTitle, formatDate } from "../components/ui";

export default function Gallery() {
  const [items, setItems] = useState<Makeover[]>([]);
  const [styles, setStyles] = useState<Style[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([listGallery(), fetchStyles()])
      .then(async ([g, s]) => {
        setItems(g);
        setStyles(s);
        const paths = g.map((m) => m.image_path).filter((p): p is string => !!p);
        if (paths.length) setUrls(await signedUrls(paths));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => (filter ? items.filter((m) => m.style === filter) : items), [items, filter]);

  if (loading) return <PageLoader />;
  if (error) return <ErrorBox>{error}</ErrorBox>;

  if (!items.length) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <h1 className="font-serif text-3xl font-semibold text-ink">Your gallery is empty</h1>
        <p className="mt-2 text-muted">Generate a makeover and tap "Save to gallery" to keep it here.</p>
        <Link to="/new">
          <Button className="mt-6">Create a makeover</Button>
        </Link>
      </div>
    );
  }

  const chip = (active: boolean) =>
    `rounded-full border px-4 py-1.5 text-sm font-medium transition ${active ? "border-moss bg-moss text-paper" : "border-line bg-white text-muted hover:text-ink"}`;

  return (
    <div>
      <SectionTitle title="Gallery" sub="Your saved makeovers, newest first." />
      <div className="mb-6 flex flex-wrap gap-2">
        <button className={chip(!filter)} onClick={() => setFilter(null)}>
          All
        </button>
        {styles.map((s) => (
          <button key={s.slug} className={chip(filter === s.slug)} onClick={() => setFilter(s.slug)}>
            {s.name}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="py-10 text-center text-muted">No saved makeovers in this style yet.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map((m) => (
            <li key={m.id}>
              <Link to={`/makeover/${m.id}`} className="group block overflow-hidden rounded-3xl border border-line bg-white transition hover:shadow-md">
                {m.image_path && urls[m.image_path] ? (
                  <img src={urls[m.image_path]} alt={`${styleName(styles, m.style)} makeover`} className="aspect-[4/3] w-full object-cover transition group-hover:scale-[1.02]" />
                ) : (
                  <div className="aspect-[4/3] bg-sand" />
                )}
                <div className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-serif text-lg font-semibold text-ink">{styleName(styles, m.style)}</p>
                    <p className="text-xs text-muted">
                      {formatDate(m.created_at)} · {m.refresh_level === "light" ? "Light refresh" : "Full makeover"}
                    </p>
                  </div>
                  {m.palette?.length ? (
                    <div className="flex -space-x-1">
                      {m.palette.map((c, i) => (
                        <span key={i} className="h-5 w-5 rounded-full border-2 border-white" style={{ backgroundColor: c.hex }} />
                      ))}
                    </div>
                  ) : null}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
