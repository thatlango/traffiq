import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, AnimatePresence } from "framer-motion";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Flame, Zap, AlertTriangle, Cloud, Construction, Eye, Car,
  Search, RefreshCw, ChevronDown, ChevronUp, MapPin, Clock,
  ThumbsUp, SlidersHorizontal, ArrowUpDown, Download,
  CheckCircle, XCircle, Map as MapIcon, TrendingUp, Shield,
} from "lucide-react";
import { api, IncidentRow, IncidentStats } from "@/lib/api";
import { formatDistanceToNow, parseISO, format, isAfter, subDays } from "date-fns";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const INCIDENT_META: Record<string, { label: string; icon: any; color: string }> = {
  accident:  { label: "Accident",       icon: Flame,         color: "#EF4444" },
  flood:     { label: "Flood",          icon: Cloud,         color: "#3B82F6" },
  pothole:   { label: "Pothole",        icon: Construction,  color: "#F97316" },
  police:    { label: "Police",         icon: Eye,           color: "#8B5CF6" },
  traffic:   { label: "Traffic Jam",    icon: Car,           color: "#F59E0B" },
  overspeed: { label: "Overspeed Zone", icon: Zap,           color: "#EF4444" },
  hazard:    { label: "Road Hazard",    icon: AlertTriangle, color: "#F97316" },
};

function getMeta(type: string) {
  return INCIDENT_META[type] ?? { label: type, icon: AlertTriangle, color: "#94A3B8" };
}

function incidentSvgIcon(type: string, highlighted = false) {
  const color = getMeta(type).color;
  const size = highlighted ? 1.4 : 1;
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="${32*size}" height="${42*size}">
      <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 26 16 26S32 26 32 16C32 7.163 24.837 0 16 0z"
        fill="${color}" stroke="${highlighted ? "white" : "rgba(255,255,255,0.8)"}" stroke-width="${highlighted ? 3 : 2}"/>
      <circle cx="16" cy="16" r="7" fill="white" opacity="0.95"/>
    </svg>`);
  return L.icon({
    iconUrl: `data:image/svg+xml,${svg}`,
    iconSize: [32 * size, 42 * size],
    iconAnchor: [16 * size, 42 * size],
    popupAnchor: [0, -44 * size],
  });
}

const DATE_OPTIONS = [
  { label: "All time", value: "all",   days: 0 },
  { label: "Today",    value: "today", days: 1 },
  { label: "7 days",   value: "week",  days: 7 },
  { label: "30 days",  value: "month", days: 30 },
];

const SORT_OPTIONS = [
  { label: "Newest",        value: "newest" },
  { label: "Oldest",        value: "oldest" },
  { label: "Most confirmed",value: "confirmed" },
];

const CHIP_BG = "hsl(var(--card))";
const CHIP_BORDER = "hsl(var(--card-border))";
const CHIP_TEXT = "hsl(var(--muted-foreground))";

function StatChip({ label, value, sub, icon: Icon, color }: { label: string; value: string | number; sub?: string; icon: any; color: string }) {
  return (
    <div className="bg-card border border-card-border rounded-xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: color + "22" }}>
        <Icon size={16} style={{ color }} />
      </div>
      <div>
        <p className="text-xl font-bold text-foreground tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}{sub ? ` · ${sub}` : ""}</p>
      </div>
    </div>
  );
}

function MiniMap({ incidents, focusedId, onFocus }: {
  incidents: IncidentRow[];
  focusedId: string | null;
  onFocus: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const markersRef   = useRef<Map<string, L.Marker>>(new Map());

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = L.map(containerRef.current, { center: [1.3733, 32.2903], zoom: 7 });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '© <a href="https://carto.com">CARTO</a>',
      subdomains: "abcd", maxZoom: 19,
    }).addTo(mapRef.current);
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const existingIds = new Set(markersRef.current.keys());
    const newIds = new Set(incidents.filter(i => i.latitude && i.longitude).map(i => i.id));

    existingIds.forEach(id => {
      if (!newIds.has(id)) { map.removeLayer(markersRef.current.get(id)!); markersRef.current.delete(id); }
    });

    incidents.filter(i => i.latitude && i.longitude).forEach(i => {
      const meta = getMeta(i.type);
      if (markersRef.current.has(i.id)) {
        markersRef.current.get(i.id)!.setIcon(incidentSvgIcon(i.type, focusedId === i.id));
        return;
      }
      const marker = L.marker([i.latitude!, i.longitude!], { icon: incidentSvgIcon(i.type, focusedId === i.id) })
        .bindPopup(`
          <div style="font-family:sans-serif;min-width:160px">
            <div style="font-weight:700;font-size:13px;color:${meta.color};margin-bottom:4px">${meta.label}</div>
            ${i.description ? `<div style="font-size:12px;color:#cbd5e1;margin-bottom:4px">${i.description}</div>` : ""}
            ${i.reporter_name ? `<div style="font-size:11px;color:#94a3b8">👤 ${i.reporter_name}</div>` : ""}
            <div style="font-size:11px;color:#94a3b8;margin-top:2px">👍 ${i.confirmed}</div>
          </div>
        `, { className: "traffiq-popup" })
        .on("click", () => onFocus(i.id))
        .addTo(map);
      markersRef.current.set(i.id, marker);
    });
  }, [incidents, focusedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focusedId) return;
    const marker = markersRef.current.get(focusedId);
    if (marker) {
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 13), { animate: true });
      marker.openPopup();
    }
    markersRef.current.forEach((m, id) => m.setIcon(incidentSvgIcon(
      [...(markersRef.current.entries())].find(([k]) => k === id)?.[1] ? "accident" : "other",
      id === focusedId
    )));
  }, [focusedId]);

  return <div ref={containerRef} className="w-full h-full" />;
}

function IncidentCard({ incident, focused, onFocus, onConfirm, onDismiss }: {
  incident: IncidentRow;
  focused: boolean;
  onFocus: (id: string | null) => void;
  onConfirm: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const meta = getMeta(incident.type);
  const Icon = meta.icon;
  const dismissed = incident.confirmed === -1;

  async function handleConfirm(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirming(true);
    try { await onConfirm(incident.id); } finally { setConfirming(false); }
  }
  async function handleDismiss(e: React.MouseEvent) {
    e.stopPropagation();
    setDismissing(true);
    try { await onDismiss(incident.id); } finally { setDismissing(false); }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className={`border-b border-border last:border-0 transition-colors ${focused ? "bg-primary/5" : ""} ${dismissed ? "opacity-50" : ""}`}
    >
      <div
        className="flex items-start gap-3 px-4 py-3.5 cursor-pointer hover:bg-muted/10 transition-colors"
        onClick={() => { setExpanded(e => !e); onFocus(focused ? null : incident.id); }}
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: meta.color + "20" }}>
          <Icon size={16} style={{ color: meta.color }} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border"
              style={{ backgroundColor: meta.color + "20", color: meta.color, borderColor: meta.color + "40" }}>
              {meta.label}
            </span>
            {incident.confirmed > 0 && (
              <span className="flex items-center gap-1 text-xs text-emerald-400"><ThumbsUp size={9} /> {incident.confirmed}</span>
            )}
            {dismissed && <span className="text-xs text-muted-foreground/50 italic">dismissed</span>}
          </div>
          {incident.description && (
            <p className="text-xs text-muted-foreground mt-1 truncate">{incident.description}</p>
          )}
          <div className="flex items-center gap-2.5 mt-1.5 text-xs text-muted-foreground/60 flex-wrap">
            {incident.reporter_name && <span className="text-muted-foreground/80">{incident.reporter_name}</span>}
            <span className="flex items-center gap-1"><Clock size={9} />{formatDistanceToNow(parseISO(incident.created_at), { addSuffix: true })}</span>
            {incident.latitude && incident.longitude && (
              <span className="flex items-center gap-1 text-primary/70"><MapPin size={9} /> Located</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
          {incident.latitude && (
            <button
              title="Focus on map"
              onClick={e => { e.stopPropagation(); onFocus(focused ? null : incident.id); }}
              className={`p-1.5 rounded-lg transition-colors ${focused ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary hover:bg-primary/10"}`}
            >
              <MapIcon size={13} />
            </button>
          )}
          {expanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3.5 pl-[3.25rem] space-y-3">
              {incident.description && (
                <p className="text-sm text-foreground/80 leading-relaxed bg-muted/20 rounded-xl px-3 py-2.5 border border-border">
                  {incident.description}
                </p>
              )}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {incident.reporter_name && (
                  <div className="bg-muted/20 rounded-lg px-3 py-2 border border-border">
                    <p className="text-muted-foreground mb-0.5">Reporter</p>
                    <p className="text-foreground font-medium">{incident.reporter_name}</p>
                  </div>
                )}
                {incident.device_platform && (
                  <div className="bg-muted/20 rounded-lg px-3 py-2 border border-border">
                    <p className="text-muted-foreground mb-0.5">Platform</p>
                    <p className="text-foreground font-medium capitalize">{incident.device_platform}</p>
                  </div>
                )}
                <div className="bg-muted/20 rounded-lg px-3 py-2 border border-border">
                  <p className="text-muted-foreground mb-0.5">Reported</p>
                  <p className="text-foreground font-medium">{format(parseISO(incident.created_at), "d MMM yyyy, HH:mm")}</p>
                </div>
                <div className="bg-muted/20 rounded-lg px-3 py-2 border border-border">
                  <p className="text-muted-foreground mb-0.5">Confirmations</p>
                  <p className="text-foreground font-medium">{incident.confirmed < 0 ? "Dismissed" : incident.confirmed}</p>
                </div>
              </div>

              {incident.latitude && incident.longitude && (
                <a
                  href={`https://maps.google.com/?q=${incident.latitude},${incident.longitude}`}
                  target="_blank" rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
                >
                  <MapPin size={11} /> Open in Google Maps ↗
                </a>
              )}

              {/* Admin actions */}
              <div className="flex items-center gap-2 pt-1 border-t border-border">
                <span className="text-xs text-muted-foreground/60 mr-1">Admin:</span>
                <button
                  disabled={confirming || dismissed}
                  onClick={handleConfirm}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <CheckCircle size={12} className={confirming ? "animate-spin" : ""} />
                  {confirming ? "Confirming…" : "Confirm"}
                </button>
                <button
                  disabled={dismissing || dismissed}
                  onClick={handleDismiss}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <XCircle size={12} className={dismissing ? "animate-spin" : ""} />
                  {dismissing ? "Dismissing…" : "Dismiss"}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-card-border rounded-xl px-3 py-2 shadow-xl text-xs">
      <p className="text-muted-foreground mb-1">{label}</p>
      <p className="font-bold text-foreground">{payload[0].value} incidents</p>
    </div>
  );
};

const PAGE_SIZE = 30;

export default function IncidentsPage() {
  const qc = useQueryClient();
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [sortBy, setSortBy]         = useState("newest");
  const [minConfirmed, setMinConfirmed] = useState(0);
  const [search, setSearch]         = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [showMap, setShowMap]       = useState(true);
  const [focusedId, setFocusedId]   = useState<string | null>(null);
  const [page, setPage]             = useState(0);

  const days = DATE_OPTIONS.find(o => o.value === dateFilter)?.days ?? 0;

  const statsQ = useQuery({ queryKey: ["incident-stats"], queryFn: api.incidentStats, refetchInterval: 60_000 });
  const incQ   = useQuery({
    queryKey: ["incidents-page", typeFilter, days, page],
    queryFn: () => api.incidents({ limit: PAGE_SIZE, offset: page * PAGE_SIZE, type: typeFilter, days }),
    refetchInterval: 30_000,
  });

  const rawIncidents = incQ.data?.incidents ?? [];
  const totalCount   = incQ.data?.total ?? 0;

  const filtered = useMemo(() => {
    let list = rawIncidents.filter(i => {
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
  }, [rawIncidents, minConfirmed, search, sortBy]);

  const mappable = useMemo(() => filtered.filter(i => i.latitude && i.longitude), [filtered]);

  const typeCounts = useMemo(() =>
    rawIncidents.reduce((acc, i) => { acc[i.type] = (acc[i.type] ?? 0) + 1; return acc; }, {} as Record<string, number>),
    [rawIncidents]
  );

  const maxConfirmed = useMemo(() => Math.max(...rawIncidents.map(i => i.confirmed), 0), [rawIncidents]);

  const activeFilters = [typeFilter !== "all", dateFilter !== "all", minConfirmed > 0, !!search].filter(Boolean).length;

  const handleConfirm = useCallback(async (id: string) => {
    await api.confirmIncident(id);
    qc.invalidateQueries({ queryKey: ["incidents-page"] });
    qc.invalidateQueries({ queryKey: ["incident-stats"] });
    qc.invalidateQueries({ queryKey: ["incidents"] });
  }, [qc]);

  const handleDismiss = useCallback(async (id: string) => {
    await api.dismissIncident(id);
    qc.invalidateQueries({ queryKey: ["incidents-page"] });
    qc.invalidateQueries({ queryKey: ["incident-stats"] });
  }, [qc]);

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

  const s = statsQ.data?.summary;
  const dailyData = (statsQ.data?.daily ?? []).map(d => ({
    day: format(parseISO(d.day), "d MMM"),
    count: Number(d.count),
  }));

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top bar */}
      <div className="flex-shrink-0 px-6 pt-6 pb-4 space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold text-foreground">Incidents</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {totalCount.toLocaleString()} total · showing {filtered.length}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => incQ.refetch()} className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
              <RefreshCw size={15} className={incQ.isFetching ? "animate-spin" : ""} />
            </button>
            <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-card border border-border text-muted-foreground hover:text-foreground transition-colors">
              <Download size={14} /> Export CSV
            </button>
            <button
              onClick={() => setShowMap(v => !v)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition-colors ${showMap ? "bg-primary/10 border-primary/30 text-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}
            >
              <MapIcon size={14} /> Map {showMap ? "on" : "off"}
            </button>
            <button
              onClick={() => setShowFilters(f => !f)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm border transition-colors ${showFilters || activeFilters > 0 ? "bg-primary/10 border-primary/30 text-primary" : "bg-card border-border text-muted-foreground hover:text-foreground"}`}
            >
              <SlidersHorizontal size={14} />
              Filters
              {activeFilters > 0 && (
                <span className="w-4 h-4 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">{activeFilters}</span>
              )}
            </button>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text" placeholder="Search…" value={search}
                onChange={e => { setSearch(e.target.value); setPage(0); }}
                className="pl-9 pr-3 py-2 text-sm bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-40"
              />
            </div>
          </div>
        </div>

        {/* Stats chips */}
        {s && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatChip label="Total"    value={Number(s.total).toLocaleString()} icon={AlertTriangle} color="#EF4444" />
            <StatChip label="Today"    value={Number(s.today)}                  icon={TrendingUp}    color="#10B981" />
            <StatChip label="Verified" value={Number(s.verified)}               icon={Shield}        color="#F59E0B" />
            <StatChip label="Located"  value={`${s.total > 0 ? Math.round((Number(s.with_location)/Number(s.total))*100) : 0}%`} icon={MapPin} color="#3B82F6" sub="have GPS" />
          </div>
        )}

        {/* Advanced filter panel */}
        <AnimatePresence>
          {showFilters && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }} className="overflow-hidden">
              <div className="bg-card border border-border rounded-2xl p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 block">Date range</label>
                    <div className="flex flex-wrap gap-1.5">
                      {DATE_OPTIONS.map(o => (
                        <button key={o.value} onClick={() => { setDateFilter(o.value); setPage(0); }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${dateFilter === o.value ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 border-border text-muted-foreground hover:text-foreground"}`}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1"><ArrowUpDown size={10} /> Sort by</label>
                    <div className="flex flex-wrap gap-1.5">
                      {SORT_OPTIONS.map(o => (
                        <button key={o.value} onClick={() => setSortBy(o.value)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${sortBy === o.value ? "bg-primary text-primary-foreground border-primary" : "bg-muted/30 border-border text-muted-foreground hover:text-foreground"}`}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {maxConfirmed > 0 && (
                    <div>
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center justify-between">
                        <span className="flex items-center gap-1"><ThumbsUp size={10} /> Min confirmations</span>
                        <span className="text-primary font-bold">{minConfirmed}</span>
                      </label>
                      <input type="range" min={0} max={maxConfirmed} value={minConfirmed}
                        onChange={e => setMinConfirmed(Number(e.target.value))}
                        className="w-full accent-amber-400" />
                    </div>
                  )}
                </div>
                {activeFilters > 0 && (
                  <button onClick={() => { setTypeFilter("all"); setDateFilter("all"); setSortBy("newest"); setMinConfirmed(0); setSearch(""); setPage(0); }}
                    className="text-xs text-primary hover:underline">
                    Reset all filters
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Type filter chips */}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setTypeFilter("all"); setPage(0); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${typeFilter === "all" ? "bg-primary text-primary-foreground border-primary shadow-md shadow-primary/20" : "bg-card border-card-border text-muted-foreground hover:text-foreground"}`}>
            All · {totalCount}
          </button>
          {Object.entries(typeCounts).sort(([, a], [, b]) => b - a).map(([type, count]) => {
            const meta = getMeta(type);
            const active = typeFilter === type;
            return (
              <button key={type} onClick={() => { setTypeFilter(active ? "all" : type); setPage(0); }}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all"
                style={active
                  ? { backgroundColor: meta.color + "25", color: meta.color, borderColor: meta.color + "70", boxShadow: `0 0 12px ${meta.color}20` }
                  : { backgroundColor: CHIP_BG, borderColor: CHIP_BORDER, color: CHIP_TEXT }}>
                {meta.label} · {count}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body: list + optional map */}
      <div className="flex-1 flex min-h-0 gap-0">
        {/* Incidents list */}
        <div className={`flex flex-col min-h-0 ${showMap ? "w-full lg:w-[420px] lg:flex-shrink-0" : "w-full"} border-r border-border`}>
          {/* Daily trend */}
          {dailyData.length > 0 && (
            <div className="flex-shrink-0 px-4 py-3 border-b border-border bg-card/50">
              <p className="text-xs font-semibold text-muted-foreground mb-2">14-day incident trend</p>
              <ResponsiveContainer width="100%" height={60}>
                <BarChart data={dailyData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <Bar dataKey="count" fill="#F59E0B" radius={[2, 2, 0, 0]} />
                  <XAxis dataKey="day" tick={{ fontSize: 9, fill: "#64748b" }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <Tooltip content={<CustomTooltip />} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Scrollable list */}
          <div className="flex-1 overflow-y-auto">
            <div className="bg-card border-b border-border divide-y-0">
              <AnimatePresence mode="popLayout">
                {filtered.length === 0 ? (
                  <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="py-16 text-center text-muted-foreground text-sm">
                    <AlertTriangle size={28} className="mx-auto mb-3 opacity-25" />
                    {activeFilters > 0 || search ? "No incidents match your filters" : "No incidents yet"}
                  </motion.div>
                ) : (
                  filtered.map(inc => (
                    <IncidentCard
                      key={inc.id} incident={inc}
                      focused={focusedId === inc.id}
                      onFocus={setFocusedId}
                      onConfirm={handleConfirm}
                      onDismiss={handleDismiss}
                    />
                  ))
                )}
              </AnimatePresence>
            </div>

            {/* Pagination */}
            {totalCount > PAGE_SIZE && (
              <div className="flex items-center justify-center gap-3 py-4 border-t border-border bg-card/50">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                  className="px-4 py-2 rounded-xl text-sm bg-card border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all">
                  ← Prev
                </button>
                <span className="text-xs text-muted-foreground">
                  Page {page + 1} of {Math.ceil(totalCount / PAGE_SIZE)}
                </span>
                <button disabled={(page + 1) * PAGE_SIZE >= totalCount} onClick={() => setPage(p => p + 1)}
                  className="px-4 py-2 rounded-xl text-sm bg-card border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all">
                  Next →
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Map panel */}
        {showMap && (
          <div className="hidden lg:flex flex-col flex-1 min-h-0 bg-muted/5 relative">
            {mappable.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-muted-foreground">
                  <MapPin size={32} className="mx-auto mb-2 opacity-25" />
                  <p className="text-sm">No located incidents</p>
                  <p className="text-xs opacity-60 mt-1">Only incidents with GPS appear here</p>
                </div>
              </div>
            ) : null}
            <MiniMap incidents={mappable} focusedId={focusedId} onFocus={setFocusedId} />
            <div className="absolute top-3 right-3 z-[1000] bg-card/90 backdrop-blur border border-border rounded-xl px-3 py-2 text-xs text-muted-foreground shadow">
              <MapPin size={10} className="inline mr-1" /> {mappable.length} located
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
