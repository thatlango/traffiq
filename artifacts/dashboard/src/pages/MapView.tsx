import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, useMemo } from "react";
import { MapPin, AlertTriangle, Users, RefreshCw, Layers, Clock } from "lucide-react";
import { api } from "@/lib/api";
import { isAfter, subDays, parseISO } from "date-fns";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const INCIDENT_META: Record<string, { label: string; color: string }> = {
  accident:  { label: "Accident",    color: "#EF4444" },
  pothole:   { label: "Pothole",     color: "#F97316" },
  flood:     { label: "Flood",       color: "#3B82F6" },
  police:    { label: "Police",      color: "#8B5CF6" },
  traffic:   { label: "Traffic Jam", color: "#F59E0B" },
  overspeed: { label: "Overspeed",   color: "#EF4444" },
  hazard:    { label: "Road Hazard", color: "#F97316" },
  other:     { label: "Other",       color: "#6B7280" },
};

const DATE_OPTIONS = [
  { label: "All",    value: "all" },
  { label: "Today",  value: "today" },
  { label: "7 days", value: "week" },
  { label: "30 days",value: "month" },
];

function incidentIcon(type: string) {
  const color = INCIDENT_META[type]?.color ?? INCIDENT_META.other.color;
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 42" width="32" height="42">
      <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 26 16 26S32 26 32 16C32 7.163 24.837 0 16 0z"
        fill="${color}" stroke="white" stroke-width="2"/>
      <circle cx="16" cy="16" r="7" fill="white" opacity="0.9"/>
    </svg>`);
  return L.icon({
    iconUrl: `data:image/svg+xml,${svg}`,
    iconSize: [32, 42],
    iconAnchor: [16, 42],
    popupAnchor: [0, -44],
  });
}

function cityIcon(count: number, max: number) {
  const size = 20 + Math.round((count / max) * 30);
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${size/2-1}" fill="#F59E0B" fill-opacity="0.7" stroke="#F59E0B" stroke-width="2"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
        font-size="${Math.max(8,size/3)}" font-weight="bold" fill="white">${count}</text>
    </svg>`);
  return L.icon({
    iconUrl: `data:image/svg+xml,${svg}`,
    iconSize: [size, size],
    iconAnchor: [size/2, size/2],
    popupAnchor: [0, -size/2-4],
  });
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-UG", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

export default function MapView() {
  const mapRef       = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef   = useRef<L.Layer[]>([]);

  const [showCities,    setShowCities]    = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [dateFilter,    setDateFilter]    = useState("all");
  const [activeTypes,   setActiveTypes]   = useState<Set<string>>(new Set(Object.keys(INCIDENT_META)));

  const incidents = useQuery({ queryKey: ["recent-incidents"], queryFn: api.recentIncidents, refetchInterval: 30_000 });
  const cities    = useQuery({ queryKey: ["cities"],           queryFn: api.signupsByCity,   refetchInterval: 60_000 });

  const toggleType = (type: string) =>
    setActiveTypes(prev => {
      const next = new Set(prev);
      next.has(type) ? next.delete(type) : next.add(type);
      return next;
    });

  const filteredIncidents = useMemo(() => {
    const cutoff = dateFilter === "today" ? subDays(new Date(), 1)
                 : dateFilter === "week"  ? subDays(new Date(), 7)
                 : dateFilter === "month" ? subDays(new Date(), 30)
                 : null;
    return (incidents.data ?? []).filter(i => {
      if (!i.latitude || !i.longitude) return false;
      if (!activeTypes.has(i.type) && !activeTypes.has("other")) return false;
      const typeKey = INCIDENT_META[i.type] ? i.type : "other";
      if (!activeTypes.has(typeKey)) return false;
      if (cutoff && !isAfter(parseISO(i.created_at), cutoff)) return false;
      return true;
    });
  }, [incidents.data, activeTypes, dateFilter]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = L.map(containerRef.current, { center: [1.3733, 32.2903], zoom: 7 });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '© <a href="https://carto.com">CARTO</a> © <a href="https://openstreetmap.org">OSM</a>',
      subdomains: "abcd", maxZoom: 19,
    }).addTo(mapRef.current);
    return () => { mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    const cityData = cities.data ?? [];
    const maxCount = Math.max(...cityData.map(c => Number(c.count)), 1);

    if (showIncidents) {
      filteredIncidents.forEach(i => {
        const meta = INCIDENT_META[i.type] ?? INCIDENT_META.other;
        const marker = L.marker([i.latitude!, i.longitude!], { icon: incidentIcon(i.type) })
          .bindPopup(`
            <div style="font-family:sans-serif;min-width:190px">
              <div style="font-weight:700;font-size:13px;margin-bottom:6px;color:${meta.color}">
                ${meta.label}
              </div>
              ${i.description ? `<div style="font-size:12px;color:#cbd5e1;margin-bottom:6px;line-height:1.5">${i.description}</div>` : ""}
              ${i.reporter_name ? `<div style="font-size:11px;color:#94a3b8">👤 ${i.reporter_name}</div>` : ""}
              <div style="font-size:11px;color:#94a3b8;margin-top:4px">🕐 ${formatDate(i.created_at)}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:2px">👍 ${i.confirmed} confirmations</div>
              ${i.latitude && i.longitude
                ? `<a href="https://maps.google.com/?q=${i.latitude},${i.longitude}" target="_blank"
                    style="display:inline-block;margin-top:8px;font-size:11px;color:#F59E0B;text-decoration:none">
                    Open in Google Maps ↗
                  </a>`
                : ""}
            </div>
          `, { className: "traffiq-popup" })
          .addTo(map);
        markersRef.current.push(marker);
      });
    }

    if (showCities) {
      cityData.filter(c => c.lat && c.lng).forEach(c => {
        const marker = L.marker([c.lat, c.lng], { icon: cityIcon(Number(c.count), maxCount) })
          .bindPopup(`
            <div style="font-family:sans-serif;min-width:140px">
              <div style="font-weight:700;font-size:13px;margin-bottom:4px;color:#F59E0B">${c.city}</div>
              <div style="font-size:12px;color:#94a3b8">${c.country}</div>
              <div style="font-size:12px;color:#cbd5e1;margin-top:4px"><strong>${c.count}</strong> registered users</div>
            </div>
          `, { className: "traffiq-popup" })
          .addTo(map);
        markersRef.current.push(marker);
      });
    }
  }, [filteredIncidents, cities.data, showIncidents, showCities]);

  const isFetching = incidents.isFetching || cities.isFetching;
  const cityCount  = (cities.data ?? []).filter(c => c.lat && c.lng).length;
  const allTypes   = useMemo(() => {
    const types = new Set((incidents.data ?? []).map(i => INCIDENT_META[i.type] ? i.type : "other"));
    return Array.from(types);
  }, [incidents.data]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 px-6 py-4 border-b border-border bg-card flex-shrink-0">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-foreground">Live Map</h2>
            <p className="text-xs text-muted-foreground">Uganda road safety — incidents & user distribution</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} />
              Live
            </div>
          </div>
        </div>

        {/* Filter row */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Date filter */}
          <div className="flex items-center gap-1 bg-muted/30 border border-border rounded-xl p-1">
            <Clock size={11} className="text-muted-foreground ml-1" />
            {DATE_OPTIONS.map(o => (
              <button
                key={o.value}
                onClick={() => setDateFilter(o.value)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  dateFilter === o.value
                    ? "bg-card text-foreground shadow-sm border border-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {o.label}
              </button>
            ))}
          </div>

          {/* Layer toggles */}
          <button
            onClick={() => setShowIncidents(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
              showIncidents ? "bg-red-500/15 text-red-400 border-red-500/30" : "text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            <AlertTriangle size={11} />
            Incidents ({filteredIncidents.length})
          </button>
          <button
            onClick={() => setShowCities(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-all ${
              showCities ? "bg-amber-500/15 text-amber-400 border-amber-500/30" : "text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            <Users size={11} />
            Cities ({cityCount})
          </button>

          {/* Per-type chips */}
          {showIncidents && allTypes.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-muted-foreground">Types:</span>
              {allTypes.map(type => {
                const meta = INCIDENT_META[type] ?? INCIDENT_META.other;
                const on = activeTypes.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => toggleType(type)}
                    className="px-2.5 py-1 rounded-full text-xs font-medium border transition-all"
                    style={on
                      ? { backgroundColor: meta.color + "22", color: meta.color, borderColor: meta.color + "55" }
                      : { backgroundColor: "transparent", color: "#64748b", borderColor: "#334155" }
                    }
                  >
                    {meta.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <div ref={containerRef} className="absolute inset-0" />

        {/* Legend */}
        <div className="absolute bottom-6 left-4 z-[1000] bg-card/90 backdrop-blur border border-border rounded-xl p-3 shadow-xl max-w-[160px]">
          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <Layers size={11} /> Legend
          </p>
          <div className="space-y-1.5">
            {Object.entries(INCIDENT_META).filter(([t]) => allTypes.includes(t)).map(([type, meta]) => (
              <div key={type} className="flex items-center gap-2 cursor-pointer" onClick={() => toggleType(type)}>
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: meta.color, opacity: activeTypes.has(type) ? 1 : 0.3 }} />
                <span className={`text-xs transition-colors ${activeTypes.has(type) ? "text-muted-foreground" : "text-muted-foreground/40"}`}>
                  {meta.label}
                </span>
              </div>
            ))}
            {showCities && (
              <div className="flex items-center gap-2 pt-1 border-t border-border mt-1">
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-amber-400" />
                <span className="text-xs text-muted-foreground">City users</span>
              </div>
            )}
          </div>
        </div>

        {/* No data state */}
        {filteredIncidents.length === 0 && cityCount === 0 && !isFetching && (
          <div className="absolute inset-0 flex items-center justify-center z-[999] pointer-events-none">
            <div className="bg-card/90 backdrop-blur border border-border rounded-2xl px-6 py-4 text-center shadow-xl">
              <MapPin size={28} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No map data for this filter</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
