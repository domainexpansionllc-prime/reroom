import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-moss";
  const styles = {
    primary: "bg-moss text-paper hover:bg-moss-dark",
    ghost: "border border-line bg-white text-ink hover:border-moss hover:text-moss",
    danger: "border border-line bg-white text-danger hover:border-danger",
  }[variant];
  return <button className={`${base} ${styles} ${className}`} {...props} />;
}

export function Spinner({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-2xl bg-danger-light px-5 py-4 text-sm text-danger">
      {children}
    </div>
  );
}

export function PageLoader() {
  return (
    <div className="flex justify-center py-24 text-moss">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-serif text-2xl font-semibold text-ink">{title}</h2>
      {sub && <p className="mt-1 text-muted">{sub}</p>}
    </div>
  );
}

export function SwatchStrip({ colors, className = "h-2" }: { colors: string[]; className?: string }) {
  return (
    <div className={`flex overflow-hidden rounded-full ${className}`}>
      {colors.map((c, i) => (
        <span key={i} className="flex-1" style={{ backgroundColor: c }} />
      ))}
    </div>
  );
}

export const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
