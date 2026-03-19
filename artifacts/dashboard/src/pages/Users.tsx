import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Radio, Smartphone, Apple, Globe, RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { api, UserRow } from "@/lib/api";
import { formatDistanceToNow, parseISO } from "date-fns";

function PlatformIcon({ platform }: { platform: string }) {
  if (platform === "ios") return <Apple size={14} className="text-gray-400" />;
  if (platform === "android") return <Smartphone size={14} className="text-green-400" />;
  return <Globe size={14} className="text-blue-400" />;
}

function Avatar({ user }: { user: UserRow }) {
  const initials = user.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  if (user.avatar_url) {
    return <img src={user.avatar_url} alt={user.name} className="w-9 h-9 rounded-full object-cover" />;
  }
  return (
    <div className="w-9 h-9 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-bold text-primary">
      {initials}
    </div>
  );
}

const PAGE_SIZE = 20;

export default function UsersPage() {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);

  const { data, isFetching } = useQuery({
    queryKey: ["users", page],
    queryFn: () => api.users(PAGE_SIZE, page * PAGE_SIZE),
  });

  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const filtered = search
    ? users.filter(u =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase()) ||
        (u.signup_city ?? "").toLowerCase().includes(search.toLowerCase())
      )
    : users;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Users</h2>
          <p className="text-sm text-muted-foreground mt-1">{total.toLocaleString()} registered drivers</p>
        </div>
        <div className="flex items-center gap-3">
          <RefreshCw size={14} className={`text-muted-foreground ${isFetching ? "animate-spin" : ""}`} />
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search users..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 text-sm bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-56"
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-5 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Location</th>
                <th className="text-left px-4 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Platform</th>
                <th className="text-left px-4 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Joined</th>
                <th className="text-left px-4 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Last Active</th>
                <th className="text-left px-4 py-3.5 font-semibold text-muted-foreground text-xs uppercase tracking-wide">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map(user => (
                <tr key={user.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <Avatar user={user} />
                      <div>
                        <p className="font-medium text-foreground">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className="text-foreground">{user.signup_city ?? "—"}</span>
                    {user.signup_country && (
                      <span className="text-muted-foreground text-xs ml-1">· {user.signup_country}</span>
                    )}
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <PlatformIcon platform={user.device_platform} />
                      <span className="text-foreground capitalize">{user.device_platform}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground text-xs">
                    {formatDistanceToNow(parseISO(user.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3.5 text-muted-foreground text-xs">
                    {formatDistanceToNow(parseISO(user.last_active), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-3.5">
                    {user.is_live ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/20">
                        <Radio size={10} />
                        Live
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground">
                        Offline
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground text-sm">
                    {search ? "No users match your search" : "No users yet"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-5 py-3.5 border-t border-border">
            <span className="text-xs text-muted-foreground">
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page === 0}
                onClick={() => setPage(p => p - 1)}
                className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed text-muted-foreground"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-medium text-foreground px-2">{page + 1} / {totalPages}</span>
              <button
                disabled={page >= totalPages - 1}
                onClick={() => setPage(p => p + 1)}
                className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed text-muted-foreground"
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
