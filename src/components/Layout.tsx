import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";

// Mark: a house split down the middle like the compare slider —
// left half outlined ("before"), right half filled ("after").
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="#2F5D46" />
      <path d="M16 8.5L8.5 14.2V23.5H16" fill="none" stroke="#F8F6F1" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M16 8.5L23.5 14.2V23.5H16Z" fill="#F8F6F1" />
      <line x1="16" y1="6" x2="16" y2="26" stroke="#F8F6F1" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2.5 font-serif text-xl font-semibold tracking-tight text-ink">
      <LogoMark />
      <span className={compact ? "hidden sm:inline" : ""}>
        <span className="text-moss">Re</span>Room
      </span>
    </span>
  );
}

export default function Layout() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const link = ({ isActive }: { isActive: boolean }) =>
    `whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm font-medium transition sm:px-3 ${isActive ? "bg-moss-light text-moss" : "text-muted hover:text-ink"}`;

  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <NavLink to="/new" aria-label="ReRoom home">
            <Logo compact />
          </NavLink>
          <nav className="flex items-center gap-0.5 sm:gap-1">
            <NavLink to="/new" className={link}>
              <span className="sm:hidden">New</span>
              <span className="hidden sm:inline">New makeover</span>
            </NavLink>
            <NavLink to="/gallery" className={link}>
              Gallery
            </NavLink>
            <button
              className="whitespace-nowrap rounded-full px-2.5 py-1.5 text-sm font-medium text-muted hover:text-ink sm:ml-1 sm:px-3"
              title={user?.email ?? undefined}
              onClick={async () => {
                await supabase.auth.signOut();
                navigate("/");
              }}
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-20 pt-8">
        <Outlet />
      </main>
    </div>
  );
}
