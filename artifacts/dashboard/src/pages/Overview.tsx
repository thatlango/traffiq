import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Users, Navigation, AlertTriangle, Activity,
  Radio, TrendingUp, Shield, MapPin, RefreshCw, ArrowRight,
} from "lucide-react";
import { api } from "@/lib/api";
import { format, parseISO } from "date-fns";

type Page = "overview" | "users" | "incidents" | "map";

const AMBER  = "#F59E0B";
const GREEN  = "#10B981";
const BLUE   = "#3B82F6";
const RED    = "#EF4444";
const PURPLE = "#8B5CF6";
const ORANGE = "#F97316";

const MODE_COLORS: Record<string, string> = {
  car: BLUE, taxi: AMBER, bus: GREEN, truck: ORANGE,
  boda: RED, bicycle: PURPLE, walking: "#06B6D4",
};

interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: any;
  color: string;
  pulse?: boolean;
  navigateTo?: Page;
  onNavigate?: (p: Page) => void;
  index?: number;
}

function StatCard({ label, value, sub, icon: Icon, color, pulse, navigateTo, onNavigate, index = 0 }: StatCardProps) {
  const clickable = navigateTo && onNavigate;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      onClick={() => clickable && onNavigate(navigateTo!)}
      className={`bg-card border border-card-border rounded-2xl p-5 flex flex-col gap-3 transition-all duration-200
        ${clickable ? "cursor-pointer hover:border-primary/40 hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5 group" : ""}`}
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-muted-foreground">{label}</span>
        <div className="relative">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
            style={{ backgroundColor: color + "22" }}>
            <Icon size={18} style={{ color }} />
          </div>
          {pulse && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-green-500 border-2 border-card animate-pulse" />}
        </div>
      </div>
      <div>
        <p className="text-3xl font-bold text-foreground tabular-nums">{Number(value).toLocaleString()}</p>
        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
      </div>
      {clickable && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground group-hover:text-primary transition-colors">
          View details <ArrowRight size={11} className="group-hover:translate-x-0.5 transition-transform" />
        </div>
      )}
    </motion.div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-card-border rounded-xl px-4 py-3 shadow-xl">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="text-sm font-semibold" style={{ color: p.color }}>
          {p.value.toLocaleString()} {p.name}
        </p>
      ))}
    </div>
  );
};

export default function OverviewPage({ onNavigate }: { onNavigate?: (p: Page) => void }) {
  const stats   = useQuery({ queryKey: ["overview"],        queryFn: api.overview,       refetchInterval: 15_000 });
  const signups = useQuery({ queryKey: ["daily-signups"],   queryFn: api.dailySignups,   refetchInterval: 60_000 });
  const journeys= useQuery({ queryKey: ["daily-journeys"],  queryFn: api.dailyJourneys,  refetchInterval: 60_000 });
  const cities  = useQuery({ queryKey: ["cities"],          queryFn: api.signupsByCity,  refetchInterval: 60_000 });
  const modes   = useQuery({ queryKey: ["modes"],           queryFn: api.transportModes, refetchInterval: 60_000 });
  const incidents= useQuery({ queryKey: ["incidents"],      queryFn: api.recentIncidents, refetchInterval: 30_000 });

  const signupsData  = (signups.data ?? []).map(d => ({ day: format(parseISO(d.day), "MMM d"), signups: Number(d.count) }));
  const journeysData = (journeys.data ?? []).map(d => ({ day: format(parseISO(d.day), "MMM d"), journeys: Number(d.count) }));
  const modesData    = (modes.data ?? []).map(d => ({
    name: d.mode.charAt(0).toUpperCase() + d.mode.slice(1),
    value: Number(d.count),
    color: MODE_COLORS[d.mode] ?? AMBER,
  }));

  const s = stats.data;
  const isFetching = stats.isFetching;

  const recentIncidents = (incidents.data ?? []).slice(0, 5);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Overview</h2>
          <p className="text-sm text-muted-foreground mt-1">Real-time TraffIQ platform metrics</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
          Auto-refreshes every 15s
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard index={0} label="Live Users"      value={s?.liveUsers ?? 0}          sub="Active now"        icon={Radio}         color={GREEN}  pulse     navigateTo="users"     onNavigate={onNavigate} />
        <StatCard index={1} label="Total Users"     value={s?.totalUsers ?? 0}         sub="All time"          icon={Users}         color={AMBER}            navigateTo="users"     onNavigate={onNavigate} />
        <StatCard index={2} label="Active Today"    value={s?.activeToday ?? 0}        sub="Last 24 hours"     icon={Activity}      color={BLUE}             navigateTo="users"     onNavigate={onNavigate} />
        <StatCard index={3} label="Total Journeys"  value={s?.totalJourneys ?? 0}      sub="All time"          icon={Navigation}    color={PURPLE}           navigateTo="map"       onNavigate={onNavigate} />
        <StatCard index={4} label="New This Week"   value={s?.newSignupsThisWeek ?? 0} sub="New signups"       icon={TrendingUp}    color={GREEN}            navigateTo="users"     onNavigate={onNavigate} />
        <StatCard index={5} label="Incidents"       value={s?.totalIncidents ?? 0}     sub="Total reported"    icon={AlertTriangle} color={RED}              navigateTo="incidents" onNavigate={onNavigate} />
        <StatCard index={6} label="Avg Safety Score" value={s?.averageSafetyScore ?? 0} sub="Platform average" icon={Shield}        color={AMBER} />
        <StatCard index={7} label="Cities"          value={(cities.data ?? []).length} sub="With users"        icon={MapPin}        color={BLUE}             navigateTo="map"       onNavigate={onNavigate} />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Daily Signups (Last 30 days)</h3>
          {signupsData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={signupsData}>
                <defs>
                  <linearGradient id="signupGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={AMBER} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={AMBER} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Area type="monotone" dataKey="signups" name="Signups" stroke={AMBER} fill="url(#signupGrad)" strokeWidth={2} dot={false} activeDot={{ r: 5, fill: AMBER }} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Daily Journeys (Last 30 days)</h3>
          {journeysData.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={journeysData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} tickLine={false} axisLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="journeys" name="Journeys" fill={BLUE} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Transport modes */}
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <h3 className="font-semibold text-foreground mb-4">Transport Modes</h3>
          {modesData.length === 0 ? (
            <div className="h-40 flex items-center justify-center text-muted-foreground text-sm">No journey data yet</div>
          ) : (
            <div className="flex flex-col gap-4">
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={modesData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={40} outerRadius={65} paddingAngle={3}>
                    {modesData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="grid grid-cols-2 gap-1.5">
                {modesData.map(m => (
                  <div key={m.name} className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: m.color }} />
                    <span className="text-xs text-muted-foreground truncate">{m.name}</span>
                    <span className="text-xs font-semibold text-foreground ml-auto">{m.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Signups by city */}
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Signups by City</h3>
            {onNavigate && (
              <button onClick={() => onNavigate("map")} className="text-xs text-primary hover:underline flex items-center gap-1">
                View map <ArrowRight size={11} />
              </button>
            )}
          </div>
          <div className="space-y-3">
            {(cities.data ?? []).slice(0, 6).map((c, i) => {
              const max = Number((cities.data ?? [])[0]?.count ?? 1);
              const pct = Math.round((Number(c.count) / max) * 100);
              return (
                <div key={c.city} className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground w-4 flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between mb-1">
                      <span className="text-xs text-foreground font-medium truncate">{c.city}</span>
                      <span className="text-xs text-muted-foreground ml-2">{c.count}</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full bg-primary"
                        initial={{ width: 0 }}
                        animate={{ width: `${pct}%` }}
                        transition={{ delay: i * 0.05, duration: 0.5 }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            {(cities.data ?? []).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No city data yet</p>
            )}
          </div>
        </div>

        {/* Recent incidents feed */}
        <div className="bg-card border border-card-border rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Recent Incidents</h3>
            {onNavigate && (
              <button onClick={() => onNavigate("incidents")} className="text-xs text-primary hover:underline flex items-center gap-1">
                View all <ArrowRight size={11} />
              </button>
            )}
          </div>
          <div className="space-y-3">
            {recentIncidents.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">No incidents yet</p>
            ) : recentIncidents.map((inc, i) => {
              const colors: Record<string, string> = {
                accident: RED, flood: BLUE, pothole: ORANGE, police: PURPLE, traffic: AMBER, overspeed: RED, hazard: ORANGE,
              };
              const color = colors[inc.type] ?? "#94a3b8";
              return (
                <motion.div
                  key={inc.id}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="flex items-center gap-3"
                >
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground capitalize truncate">{inc.type.replace(/_/g, " ")}</p>
                    {inc.description && <p className="text-xs text-muted-foreground truncate">{inc.description}</p>}
                  </div>
                  <span className="text-[10px] text-muted-foreground/60 flex-shrink-0">
                    {format(parseISO(inc.created_at), "HH:mm")}
                  </span>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
