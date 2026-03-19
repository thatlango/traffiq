import { useState, useEffect } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Users,
  AlertTriangle,
  Menu,
  X,
  Radio,
  Map,
  LogOut,
} from "lucide-react";
import OverviewPage from "@/pages/Overview";
import UsersPage from "@/pages/Users";
import IncidentsPage from "@/pages/Incidents";
import AdminLogin from "@/auth/AdminLogin";
import { api } from "@/lib/api";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchInterval: 30_000, staleTime: 10_000 } },
});

type Page = "overview" | "users" | "incidents";

const NAV = [
  { id: "overview" as Page, label: "Overview", icon: LayoutDashboard },
  { id: "users" as Page, label: "Users", icon: Users },
  { id: "incidents" as Page, label: "Incidents", icon: AlertTriangle },
];

const SESSION_KEY = "traffiq_admin_session";

interface AdminSession {
  email: string;
  name: string;
  picture?: string;
}

function LivePulse() {
  const { data } = useQuery({ queryKey: ["overview"], queryFn: api.overview });
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-500/10 border border-green-500/20">
      <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
      <span className="text-xs font-semibold text-green-400">
        {data?.liveUsers ?? 0} live
      </span>
    </div>
  );
}

function Sidebar({ page, setPage, open, setOpen, session, onSignOut }: {
  page: Page;
  setPage: (p: Page) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  session: AdminSession;
  onSignOut: () => void;
}) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 bg-black/60 z-40 lg:hidden"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        className={`fixed top-0 left-0 h-full w-64 z-50 flex flex-col
          bg-sidebar border-r border-sidebar-border
          transition-transform duration-300 ease-in-out
          ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0 lg:static lg:z-auto`}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-6 py-5 border-b border-sidebar-border">
          <div className="w-9 h-9 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Map size={18} className="text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-foreground tracking-tight">TraffIQ</h1>
            <p className="text-xs text-muted-foreground">Admin Dashboard</p>
          </div>
          <button
            onClick={() => setOpen(false)}
            className="ml-auto lg:hidden text-muted-foreground hover:text-foreground"
          >
            <X size={18} />
          </button>
        </div>

        {/* Live indicator */}
        <div className="px-4 py-3">
          <LivePulse />
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-2 space-y-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setPage(id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all
                ${page === id
                  ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                  : "text-muted-foreground hover:text-foreground hover:bg-sidebar-accent"
                }`}
            >
              <Icon size={18} />
              {label}
            </button>
          ))}
        </nav>

        {/* Admin profile + sign out */}
        <div className="px-4 py-4 border-t border-sidebar-border space-y-3">
          <div className="flex items-center gap-3">
            {session.picture ? (
              <img src={session.picture} alt="" className="w-8 h-8 rounded-full" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                {session.name[0]}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{session.name}</p>
              <p className="text-xs text-muted-foreground truncate">{session.email}</p>
            </div>
          </div>
          <button
            onClick={onSignOut}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
          >
            <LogOut size={14} />
            Sign out
          </button>
          <p className="text-xs text-muted-foreground/60">traffiq.tukutuku.org</p>
        </div>
      </aside>
    </>
  );
}

function Shell({ session, onSignOut }: { session: AdminSession; onSignOut: () => void }) {
  const [page, setPage] = useState<Page>("overview");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar
        page={page}
        setPage={setPage}
        open={sidebarOpen}
        setOpen={setSidebarOpen}
        session={session}
        onSignOut={onSignOut}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center gap-4 px-4 py-3 border-b border-border bg-card">
          <button onClick={() => setSidebarOpen(true)} className="text-muted-foreground hover:text-foreground">
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2">
            <Map size={18} className="text-primary" />
            <span className="font-bold text-foreground">TraffIQ</span>
          </div>
          <div className="ml-auto"><LivePulse /></div>
        </header>

        <main className="flex-1 overflow-y-auto">
          {page === "overview" && <OverviewPage />}
          {page === "users" && <UsersPage />}
          {page === "incidents" && <IncidentsPage />}
        </main>
      </div>
    </div>
  );
}

function AuthGate({ children }: { children: (session: AdminSession, signOut: () => void) => React.ReactNode }) {
  const [session, setSession] = useState<AdminSession | null>(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });

  const handleAuth = (email: string, name: string, picture?: string) => {
    const s = { email, name, picture };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  };

  const handleSignOut = () => {
    sessionStorage.removeItem(SESSION_KEY);
    setSession(null);
  };

  if (!session) return <AdminLogin onAuth={handleAuth} />;
  return <>{children(session, handleSignOut)}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGate>
        {(session, signOut) => <Shell session={session} onSignOut={signOut} />}
      </AuthGate>
    </QueryClientProvider>
  );
}
