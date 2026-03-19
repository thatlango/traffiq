import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search, Radio, Smartphone, Apple, Globe, RefreshCw,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
  MapPin, Clock, ArrowUpDown, Users as UsersIcon,
} from "lucide-react";
import { api, UserRow } from "@/lib/api";
import { formatDistanceToNow, parseISO } from "date-fns";

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === "ios")     return <Apple size={13} className="text-gray-300" />;
  if (platform === "android") return <Smartphone size={13} className="text-green-400" />;
  return <Globe size={13} className="text-blue-400" />;
}

function Avatar({ user }: { user: UserRow }) {
  const initials = user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  if (user.avatar_url) return <img src={user.avatar_url} alt={user.name} className="w-9 h-9 rounded-full object-cover ring-2 ring-border" />;
  return (
    <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary">
      {initials}
    </div>
  );
}

const PLATFORM_OPTS = [
  { label: "All",     value: "all" },
  { label: "Android", value: "android" },
  { label: "iOS",     value: "ios" },
  { label: "Web",     value: "web" },
];

const SORT_OPTS = [
  { label: "Newest",      value: "newest" },
  { label: "Last active", value: "active" },
  { label: "Name A–Z",    value: "name" },
];

const PAGE_SIZE = 20;

function UserCard({ user }: { user: UserRow }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <motion.tr
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="border-b border-border last:border-0"
      style={{ display: "table-row" }}
    >
      {/* Main row */}
      <td colSpan={6} className="p-0">
        <div
          className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/10 transition-colors cursor-pointer"
          onClick={() => setExpanded(e => !e)}
        >
          {/* Avatar */}
          <div className="relative flex-shrink-0">
            <Avatar user={user} />
            {user.is_live && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-green-500 border-2 border-card" />
            )}
          </div>

          {/* Name + email */}
          <div className="flex-1 min-w-0">
            <p className="font-medium text-foreground text-sm truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground truncate">{user.email}</p>
          </div>

          {/* Location */}
          <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground min-w-[100px]">
            {user.signup_city ? (
              <><MapPin size={11} className="flex-shrink-0" /> {user.signup_city}</>
            ) : "—"}
          </div>

          {/* Platform */}
          <div className="hidden md:flex items-center gap-1.5 text-xs text-muted-foreground min-w-[80px] capitalize">
            <PlatformIcon platform={user.device_platform} />
            {user.device_platform}
          </div>

          {/* Last active */}
          <div className="hidden lg:block text-xs text-muted-foreground min-w-[90px]">
            {formatDistanceToNow(parseISO(user.last_active), { addSuffix: true })}
          </div>

          {/* Status */}
          <div className="flex-shrink-0">
            {user.is_live ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/20">
                <Radio size={9} className="animate-pulse" /> Live
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs text-muted-foreground bg-muted border border-border">
                Offline
              </span>
            )}
          </div>

          <button className="text-muted-foreground flex-shrink-0">
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>

        {/* Expanded detail panel */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="px-5 pb-4 pl-[4.75rem] grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 text-xs bg-muted/5 border-t border-border">
                <div className="py-3">
                  <p className="text-muted-foreground mb-1 uppercase tracking-wide text-[10px] font-semibold">Joined</p>
                  <p className="text-foreground flex items-center gap-1"><Clock size={11} /> {formatDistanceToNow(parseISO(user.created_at), { addSuffix: true })}</p>
                </div>
                <div className="py-3">
                  <p className="text-muted-foreground mb-1 uppercase tracking-wide text-[10px] font-semibold">Location</p>
                  <p className="text-foreground">{[user.signup_city, user.signup_country].filter(Boolean).join(", ") || "Unknown"}</p>
                </div>
                <div className="py-3">
                  <p className="text-muted-foreground mb-1 uppercase tracking-wide text-[10px] font-semibold">Platform</p>
                  <p className="text-foreground capitalize flex items-center gap-1.5"><PlatformIcon platform={user.device_platform} />{user.device_platform}</p>
                </div>
                <div className="py-3">
                  <p className="text-muted-foreground mb-1 uppercase tracking-wide text-[10px] font-semibold">User ID</p>
                  <p className="text-foreground font-mono text-[11px] truncate">{user.id}</p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </td>
    </motion.tr>
  );
}

export default function UsersPage() {
  const [search, setSearch]       = useState("");
  const [platform, setPlatform]   = useState("all");
  const [statusFilter, setStatus] = useState<"all" | "live" | "offline">("all");
  const [sortBy, setSortBy]       = useState("newest");
  const [page, setPage]           = useState(0);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["users", page],
    queryFn: () => api.users(PAGE_SIZE, page * PAGE_SIZE),
    refetchInterval: 5_000,
  });

  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filtered = useMemo(() => {
    let list = users.filter(u => {
      if (platform !== "all" && u.device_platform !== platform) return false;
      if (statusFilter === "live" && !u.is_live) return false;
      if (statusFilter === "offline" && u.is_live) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!u.name.toLowerCase().includes(q) && !u.email.toLowerCase().includes(q) && !(u.signup_city ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });

    if (sortBy === "active") list = [...list].sort((a, b) => b.last_active.localeCompare(a.last_active));
    if (sortBy === "name")   list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [users, platform, statusFilter, search, sortBy]);

  const liveCount = users.filter(u => u.is_live).length;

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Users</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {total.toLocaleString()} registered · <span className="text-green-400 font-medium">{liveCount} live now</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => refetch()} className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
          </button>

          {/* Sort */}
          <div className="flex items-center gap-1 bg-muted/40 border border-border rounded-xl p-1">
            <ArrowUpDown size={12} className="text-muted-foreground ml-1.5" />
            {SORT_OPTS.map(o => (
              <button
                key={o.value}
                onClick={() => setSortBy(o.value)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  sortBy === o.value ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(0); }}
              className="pl-9 pr-4 py-2 text-sm bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-48"
            />
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Platform */}
        <div className="flex items-center gap-1 bg-muted/30 border border-border rounded-xl p-1">
          {PLATFORM_OPTS.map(o => (
            <button
              key={o.value}
              onClick={() => { setPlatform(o.value); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                platform === o.value
                  ? "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        {/* Status */}
        <div className="flex items-center gap-1 bg-muted/30 border border-border rounded-xl p-1">
          {(["all", "live", "offline"] as const).map(s => (
            <button
              key={s}
              onClick={() => { setStatus(s); setPage(0); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                statusFilter === s
                  ? s === "live"
                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                    : "bg-card text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s === "live" && <Radio size={9} className="inline mr-1 animate-pulse" />}
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {(search || platform !== "all" || statusFilter !== "all") && (
          <button
            onClick={() => { setSearch(""); setPlatform("all"); setStatus("all"); setPage(0); }}
            className="text-xs text-primary hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left px-5 py-3 font-semibold text-muted-foreground text-xs uppercase tracking-wide" colSpan={6}>
                  <div className="flex items-center gap-2">
                    <UsersIcon size={12} />
                    {filtered.length} users shown
                    {filtered.length !== users.length && <span className="text-primary">(filtered)</span>}
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence mode="popLayout">
                {filtered.length === 0 ? (
                  <tr key="empty">
                    <td colSpan={6} className="px-5 py-14 text-center text-muted-foreground text-sm">
                      <UsersIcon size={28} className="mx-auto mb-3 opacity-25" />
                      {search || platform !== "all" || statusFilter !== "all" ? "No users match your filters" : "No users yet"}
                    </td>
                  </tr>
                ) : (
                  filtered.map(user => <UserCard key={user.id} user={user} />)
                )}
              </AnimatePresence>
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-border bg-muted/10">
            <span className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages} · {total} total users
            </span>
            <div className="flex items-center gap-1">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed text-muted-foreground"
              >
                <ChevronLeft size={16} />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = page <= 2 ? i : page - 2 + i;
                if (p >= totalPages) return null;
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`w-7 h-7 rounded-lg text-xs font-medium transition-all ${
                      p === page ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {p + 1}
                  </button>
                );
              })}
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 disabled:cursor-not-allowed text-muted-foreground"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
