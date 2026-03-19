import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  Flame, Zap, AlertTriangle, Cloud, Construction,
  Eye, Car, Search, RefreshCw, ChevronDown, ChevronUp,
  MapPin, Clock, ThumbsUp, SlidersHorizontal, ArrowUpDown,
  Download,
} from "lucide-react";
import { api, IncidentRow } from "@/lib/api";
import { formatDistanceToNow, parseISO, isAfter, subDays } from "date-fns";

const INCIDENT_META: Record<string, { label: string; icon: any; color: string }> = {
  accident:  { label: "Accident",       icon: Flame,         color: "#EF4444" },
  flood:     { label: "Flood",          icon: Cloud,         color: "#3B82F6" },
  pothole:   { label: "Pothole",        icon: Construction,  color: "#F97316" },
  police:    { label: "Police",         icon: Eye,           color: "#8B5CF6" },
  traffic:   { label: "Traffic Jam",    icon: Car,           color: "#F59E0B" },
  overspeed: { label: "Overspeed Zone", icon: Zap,           color: "#EF4444" },
  hazard:    { label: "Road Hazard",    icon: AlertTriangle, color: "#F97316" },
};

const DATE_OPTIONS = [
  { label: "All time", value: "all" },
  { label: "Today",    value: "today" },
  { label: "7 days",   value: "week" },
  { label: "30 days",  value: "month" },
];

const SORT_OPTIONS = [
  { label: "Newest first",       value: "newest" },
  { label: "Oldest first",       value: "oldest" },
  { label: "Most confirmed",     value: "confirmed" },
];

function IncidentBadge({ type }: { type: string }) {
  const meta = INCIDENT_META[type] ?? { label: type, icon: AlertTriangle, color: "#94A3B8" };
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border"
      style={{ backgroundColor: meta.color + "20", color: meta.color, borderColor: meta.color + "40" }}
    >
      <Icon size={11} /> {meta.label}
    </span>
  );
}

function IncidentCard({ incident }: { incident: IncidentRow }) {
  const [expanded, setExpanded] = useState(false);
  const meta = INCIDENT_META[incident.type] ?? { label: incident.type, icon: AlertTriangle, color: "#94A3B8" };
  const Icon = meta.icon;
  const hasExtra = incident.description || (incident.latitude && incident.longitude);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="border-b border-border last:border-0"
    >
      <div
        className={`flex items-start gap-4 px-5 py-4 transition-colors ${hasExtra ? "cursor-pointer hover:bg-muted/10" : ""}`}
        onClick={() => hasExtra && setExpanded(e => !e)}
      >
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
          style={{ backgroundColor: meta.color + "20" }}
        >
          <Icon size={18} style={{ color: meta.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <IncidentBadge type={incident.type} />
            {incident.confirmed > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-emerald-400">
                <ThumbsUp size={10} /> {incident.confirmed}
              </span>
            )}
            {incident.device_platform && (
              <span className="text-xs text-muted-foreground/60 capitalize">{incident.device_platform}</span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
            {incident.reporter_name && <span className="font-medium text-foreground/70">{incident.reporter_name}</span>}
            <span className="flex items-center gap-1"><Clock size={10} /> {formatDistanceToNow(parseISO(incident.created_at), { addSuffix: true })}</span>
            {incident.latitude && incident.longitude && (
              <span className="flex items-center gap-1 text-muted-foreground/60">
                <MapPin size={10} /> {incident.latitude.toFixed(4)}, {incident.longitude.toFixed(4)}
              </span>
            )}
          </div>
        </div>

        {hasExtra && (
          <button className="text-muted-foreground mt-1 flex-shrink-0" onClick={e => { e.stopPropagation(); setExpanded(x => !x); }}>
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            key="details"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-5 pb-4 pl-[4.75rem] space-y-3">
              {incident.description && (
                <p className="text-sm text-foreground/80 leading-relaxed bg-muted/20 rounded-xl px-4 py-3 border border-border">
                  {incident.description}
                </p>
              )}
              {incident.latitude && incident.longitude && (
                <a
                  href={`https://maps.google.com/?q=${incident.latitude},${incident.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
                >
                  <MapPin size={12} /> Open in Google Maps ↗
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function IncidentsPage() {
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [sortBy, setSortBy]       = useState("newest");
  const [minConfirmed, setMinConfirmed] = useState(0);
  const [search, setSearch]       = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const { data = [], isFetching, refetch } = useQuery({
    queryKey: ["incidents"],
    queryFn: api.recentIncidents,
    refetchInterval: 30_000,
  });

  const typeCounts = useMemo(() =>
    data.reduce((acc, i) => { acc[i.type] = (acc[i.type] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    [data]
  );

  const filtered = useMemo(() => {
    const cutoff = dateFilter === "today" ? subDays(new Date(), 1)
                 : dateFilter === "week"  ? subDays(new Date(), 7)
                 : dateFilter === "month" ? subDays(new Date(), 30)
                 : null;

    let list = data.filter(i => {
      if (typeFilter !== "all" && i.type !== typeFilter) return false;
      if (cutoff && !isAfter(parseISO(i.created_at), cutoff)) return false;
      if (i.confirmed < minConfirmed) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!i.type.includes(q) && !(i.reporter_name ?? "").toLowerCase().includes(q) && !(i.description ?? "").toLowerCase().includes(q)) return false;
      }
      return true;
    });

    if (sortBy === "oldest")    list = [...list].sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (sortBy === "confirmed") list = [...list].sort((a, b) => b.confirmed - a.confirmed);
    return list;
  }, [data, typeFilter, dateFilter, sortBy, minConfirmed, search]);

  const maxConfirmed = useMemo(() => Math.max(...data.map(i => i.confirmed), 0), [data]);

  function exportCSV() {
    const rows = [
      ["Type", "Description", "Reporter", "Confirmed", "Latitude", "Longitude", "Created"],
      ...filtered.map(i => [i.type, i.description ?? "", i.reporter_name ?? "", i.confirmed, i.latitude ?? "", i.longitude ?? "", i.created_at]),
    ];
    const csv = rows.map(r => r.map(String).map(v => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "traffiq-incidents.csv";
    a.click();
  }

  const activeFilters = [typeFilter !== "all", dateFilter !== "all", minConfirmed > 0, !!search].filter(Boolean).length;

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Incidents</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Showing <strong className="text-foreground">{filtered.length}</strong> of {data.length} reports
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => refetch()}
            className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw size={15} className={isFetching ? "animate-spin" : ""} />
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-card border border-border text-muted-foreground hover:text-foreground transition-colors"
          >
            <Download size={14} /> Export CSV
          </button>
          <button
            onClick={() => setShowFilters(f => !f)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition-colors ${
              showFilters || activeFilters > 0
                ? "bg-primary/10 border-primary/30 text-primary"
                : "bg-card border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <SlidersHorizontal size={14} />
            Filters
            {activeFilters > 0 && (
              <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                {activeFilters}
              </span>
            )}
          </button>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 text-sm bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-44"
            />
          </div>
        </div>
      </div>

      {/* Expanded filter panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="bg-card border border-border rounded-2xl p-5 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {/* Date range */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Date range</label>
                  <div className="flex flex-wrap gap-2">
                    {DATE_OPTIONS.map(o => (
                      <button
                        key={o.value}
                        onClick={() => setDateFilter(o.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          dateFilter === o.value
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Sort */}
                <div>
                  <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block flex items-center gap-1.5"><ArrowUpDown size={11} /> Sort by</label>
                  <div className="flex flex-wrap gap-2">
                    {SORT_OPTIONS.map(o => (
                      <button
                        key={o.value}
                        onClick={() => setSortBy(o.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                          sortBy === o.value
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/40 border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Min confirmations */}
                {maxConfirmed > 0 && (
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center justify-between">
                      <span className="flex items-center gap-1"><ThumbsUp size={11} /> Min confirmations</span>
                      <span className="text-primary font-bold">{minConfirmed}</span>
                    </label>
                    <input
                      type="range" min={0} max={maxConfirmed}
                      value={minConfirmed}
                      onChange={e => setMinConfirmed(Number(e.target.value))}
                      className="w-full accent-amber-400"
                    />
                  </div>
                )}
              </div>

              {/* Reset */}
              {activeFilters > 0 && (
                <button
                  onClick={() => { setTypeFilter("all"); setDateFilter("all"); setSortBy("newest"); setMinConfirmed(0); setSearch(""); }}
                  className="text-xs text-primary hover:underline"
                >
                  Reset all filters
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setTypeFilter("all")}
          className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all ${
            typeFilter === "all"
              ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20"
              : "bg-card border-card-border text-muted-foreground hover:text-foreground hover:border-border"
          }`}
        >
          All · {data.length}
        </button>
        {Object.entries(typeCounts).sort(([, a], [, b]) => b - a).map(([type, count]) => {
          const meta = INCIDENT_META[type] ?? { label: type, color: "#94A3B8" };
          const active = typeFilter === type;
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(active ? "all" : type)}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold border transition-all"
              style={active
                ? { backgroundColor: meta.color + "25", color: meta.color, borderColor: meta.color + "70", boxShadow: `0 0 12px ${meta.color}20` }
                : { backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--card-border))", color: "hsl(var(--muted-foreground))" }
              }
            >
              {meta.label} · {count}
            </button>
          );
        })}
      </div>

      {/* Incidents list */}
      <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
        <AnimatePresence mode="popLayout">
          {filtered.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-16 text-center text-muted-foreground text-sm"
            >
              <AlertTriangle size={32} className="mx-auto mb-3 opacity-30" />
              {activeFilters > 0 || search ? "No incidents match your filters" : "No incidents reported yet"}
            </motion.div>
          ) : (
            filtered.map(incident => (
              <IncidentCard key={incident.id} incident={incident} />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
