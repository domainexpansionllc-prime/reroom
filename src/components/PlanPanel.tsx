import type { PaletteColor, Tips } from "../lib/api";

// Palette swatches + "keep" and "change first" lists from the AI designer.
export default function PlanPanel({ palette, tips }: { palette: PaletteColor[] | null; tips: Tips | null }) {
  const keep = tips?.keep ?? [];
  const change = tips?.change_first ?? [];
  if (!palette?.length && !keep.length && !change.length) return null;

  return (
    <div className="space-y-6">
      {!!palette?.length && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Your 60 · 30 · 10 palette</h3>
          <ul className="space-y-2">
            {palette.map((c, i) => (
              <li key={i} className="flex items-center gap-3 rounded-2xl border border-line bg-white p-2.5">
                <span className="h-11 w-11 shrink-0 rounded-xl border border-black/5" style={{ backgroundColor: c.hex }} />
                <div className="min-w-0">
                  <p className="font-medium text-ink">
                    {c.name || c.hex} <span className="ml-1 font-mono text-xs uppercase text-muted">{c.hex}</span>
                  </p>
                  <p className="truncate text-xs text-muted">{c.role}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!change.length && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Change first</h3>
          <ol className="space-y-2">
            {change.map((c, i) => (
              <li key={i} className="flex gap-3 rounded-2xl border border-line bg-white p-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-moss text-xs font-semibold text-paper">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink">
                    {c.item}
                    {c.cost && <span className="ml-2 rounded-full bg-sand px-2 py-0.5 text-xs font-medium text-muted">{c.cost}</span>}
                  </p>
                  {c.why && <p className="text-sm text-muted">{c.why}</p>}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {!!keep.length && (
        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">Keep</h3>
          <ul className="space-y-2">
            {keep.map((k, i) => (
              <li key={i} className="flex gap-3 text-sm text-ink">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-moss" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                  <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {k}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
