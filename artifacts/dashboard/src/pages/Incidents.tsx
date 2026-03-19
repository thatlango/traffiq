import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Flame, Zap, AlertTriangle, Cloud, Construction,
  Eye, Car, Search, RefreshCw,
} from "lucide-react";
import { api, IncidentRow } from "@/lib/api";
import { formatDistanceToNow, parseISO } from "date-fns";

const INCIDENT_META: Record<string, { label: string; icon: any; color: string }> = {
  accident:    { label: "Accident",       icon: Flame,         color: "#EF4444" },
  flood:       { label: "Flood",          icon: Cloud,         color: "#3B82F6" },
  pothole:     { label: "Pothole",        icon: Construction,  color: "#F97316" },
  police:      { label: "Police",         icon: Eye,           color: "#8B5CF6" },
  traffic:     { label: "Traffic Jam",    icon: Car,           color: "#F59E0B" },
  overspeed:   { label: "Overspeed Zone", icon: Zap,           color: "#EF4444" },
  hazard:      { label: "Road Hazard",    icon: AlertTriangle, color: "#F97316" },
};

function IncidentBadge({ type }: { type: string }) {
  const meta = INCIDENT_META[type] ?? { label: type, icon: AlertTriangle, color: "#94A3B8" };
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border"
      style={{ backgroundColor: meta.color + "20", color: meta.color, borderColor: meta.color + "40" }}
    >
      <Icon size={11} />
      {meta.label}
    </span>
  );
}

const ALL = "all";

export default function IncidentsPage() {
  const [typeFilter, setTypeFilter] = useState(ALL);
  const [search, setSearch] = useState("");

  const { data = [], isFetching } = useQuery({
    queryKey: ["incidents"],
    queryFn: api.recentIncidents,
  });

  const presentTypes = Array.from(new Set(data.map(i => i.type)));

  const filtered = data.filter(i => {
    const matchesType = typeFilter === ALL || i.type === typeFilter;
    const matchesSearch = !search ||
      i.type.includes(search.toLowerCase()) ||
      (i.reporter_name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (i.description ?? "").toLowerCase().includes(search.toLowerCase());
    return matchesType && matchesSearch;
  });

  // Type summary counts
  const typeCounts = data.reduce((acc, i) => {
    acc[i.type] = (acc[i.type] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Incidents</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {data.length} recent reports · crowdsourced by the community
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshCw size={14} className={`text-muted-foreground ${isFetching ? "animate-spin" : ""}`} />
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search reports..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9 pr-4 py-2 text-sm bg-card border border-border rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 w-48"
            />
          </div>
        </div>
      </div>

      {/* Type summary cards */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => setTypeFilter(ALL)}
          className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all
            ${typeFilter === ALL
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card border-card-border text-muted-foreground hover:text-foreground"
            }`}
        >
          All · {data.length}
        </button>
        {Object.entries(typeCounts).sort(([,a], [,b]) => b - a).map(([type, count]) => {
          const meta = INCIDENT_META[type] ?? { label: type, icon: AlertTriangle, color: "#94A3B8" };
          const active = typeFilter === type;
          return (
            <button
              key={type}
              onClick={() => setTypeFilter(active ? ALL : type)}
              className="px-4 py-2 rounded-xl text-sm font-medium border transition-all"
              style={active
                ? { backgroundColor: meta.color + "22", color: meta.color, borderColor: meta.color + "66" }
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
        <div className="divide-y divide-border">
          {filtered.map(incident => {
            const meta = INCIDENT_META[incident.type] ?? { label: incident.type, icon: AlertTriangle, color: "#94A3B8" };
            const Icon = meta.icon;
            return (
              <div key={incident.id} className="flex items-start gap-4 px-5 py-4 hover:bg-muted/10 transition-colors">
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
                      <span className="text-xs text-muted-foreground">
                        👍 {incident.confirmed} confirmed
                      </span>
                    )}
                  </div>
                  {incident.description && (
                    <p className="text-sm text-foreground mt-1.5 leading-relaxed">{incident.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                    {incident.reporter_name && (
                      <span>by {incident.reporter_name}</span>
                    )}
                    {incident.device_platform && (
                      <span className="capitalize">{incident.device_platform}</span>
                    )}
                    {incident.latitude && incident.longitude && (
                      <a
                        href={`https://maps.google.com/?q=${incident.latitude},${incident.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        View on map ↗
                      </a>
                    )}
                    <span>{formatDistanceToNow(parseISO(incident.created_at), { addSuffix: true })}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-5 py-16 text-center text-muted-foreground text-sm">
              {search || typeFilter !== ALL ? "No incidents match your filter" : "No incidents reported yet"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
