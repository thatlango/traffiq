import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { MapPin, AlertTriangle, Users, RefreshCw, Layers } from "lucide-react";
import { api, type CityRow, type IncidentRow } from "@/lib/api";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

const INCIDENT_COLORS: Record<string, string> = {
  accident: "#EF4444",
  pothole: "#F97316",
  flood: "#3B82F6",
  roadblock: "#8B5CF6",
  breakdown: "#F59E0B",
  other: "#6B7280",
};

function incidentIcon(type: string) {
  const color = INCIDENT_COLORS[type] ?? INCIDENT_COLORS.other;
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
  const opacity = 0.7;
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 1}"
        fill="#F59E0B" fill-opacity="${opacity}" stroke="#F59E0B" stroke-width="2"/>
      <text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle"
        font-size="${Math.max(8, size / 3)}" font-weight="bold" fill="white">${count}</text>
    </svg>`);
  return L.icon({
    iconUrl: `data:image/svg+xml,${svg}`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 4],
  });
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString("en-UG", {
      day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch { return iso; }
}

type Layer = "incidents" | "cities";

export default function MapView() {
  const mapRef = useRef<L.Map | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const markersRef = useRef<L.Layer[]>([]);

  const [activeLayers, setActiveLayers] = useState<Set<Layer>>(new Set(["incidents", "cities"]));
  const [selected, setSelected] = useState<IncidentRow | CityRow | null>(null);

  const incidents = useQuery({ queryKey: ["recent-incidents"], queryFn: api.recentIncidents, refetchInterval: 30_000 });
  const cities = useQuery({ queryKey: ["cities"], queryFn: api.signupsByCity, refetchInterval: 60_000 });

  const toggleLayer = (l: Layer) =>
    setActiveLayers(prev => {
      const next = new Set(prev);
      next.has(l) ? next.delete(l) : next.add(l);
      return next;
    });

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    mapRef.current = L.map(containerRef.current, {
      center: [1.3733, 32.2903],
      zoom: 7,
      zoomControl: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      attribution: '© <a href="https://carto.com">CARTO</a> © <a href="https://openstreetmap.org">OSM</a>',
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(mapRef.current);
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach(m => map.removeLayer(m));
    markersRef.current = [];

    const incidentData = incidents.data ?? [];
    const cityData = cities.data ?? [];
    const maxCityCount = Math.max(...cityData.map(c => Number(c.count)), 1);

    if (activeLayers.has("incidents")) {
      incidentData
        .filter(i => i.latitude != null && i.longitude != null)
        .forEach(i => {
          const marker = L.marker([i.latitude!, i.longitude!], { icon: incidentIcon(i.type) })
            .bindPopup(`
              <div style="font-family:sans-serif;min-width:180px">
                <div style="font-weight:700;font-size:13px;margin-bottom:4px;color:${INCIDENT_COLORS[i.type] ?? "#6B7280"}">
                  ${i.type.charAt(0).toUpperCase() + i.type.slice(1)}
                </div>
                ${i.description ? `<div style="font-size:12px;color:#cbd5e1;margin-bottom:6px">${i.description}</div>` : ""}
                ${i.reporter_name ? `<div style="font-size:11px;color:#94a3b8">Reported by: ${i.reporter_name}</div>` : ""}
                <div style="font-size:11px;color:#94a3b8;margin-top:2px">${formatDate(i.created_at)}</div>
                <div style="font-size:11px;color:#64748b;margin-top:2px">👍 ${i.confirmed} confirmations</div>
              </div>
            `, { className: "traffiq-popup" })
            .addTo(map);
          markersRef.current.push(marker);
        });
    }

    if (activeLayers.has("cities")) {
      cityData
        .filter(c => c.lat != null && c.lng != null)
        .forEach(c => {
          const marker = L.marker([c.lat, c.lng], { icon: cityIcon(Number(c.count), maxCityCount) })
            .bindPopup(`
              <div style="font-family:sans-serif;min-width:140px">
                <div style="font-weight:700;font-size:13px;margin-bottom:4px;color:#F59E0B">${c.city}</div>
                <div style="font-size:12px;color:#94a3b8">${c.country}</div>
                <div style="font-size:12px;color:#cbd5e1;margin-top:4px">
                  <strong>${c.count}</strong> registered users
                </div>
              </div>
            `, { className: "traffiq-popup" })
            .addTo(map);
          markersRef.current.push(marker);
        });
    }
  }, [incidents.data, cities.data, activeLayers]);

  const incidentCount = (incidents.data ?? []).filter(i => i.latitude && i.longitude).length;
  const cityCount = (cities.data ?? []).filter(c => c.lat && c.lng).length;
  const isFetching = incidents.isFetching || cities.isFetching;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border bg-card flex-shrink-0 flex-wrap gap-y-2">
        <div>
          <h2 className="text-lg font-bold text-foreground">Live Map</h2>
          <p className="text-xs text-muted-foreground">Uganda road safety — incidents & user distribution</p>
        </div>

        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {/* Layer toggles */}
          <div className="flex items-center gap-1 p-1 bg-muted rounded-xl">
            <button
              onClick={() => toggleLayer("incidents")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeLayers.has("incidents")
                  ? "bg-red-500/20 text-red-400 border border-red-500/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <AlertTriangle size={12} />
              Incidents ({incidentCount})
            </button>
            <button
              onClick={() => toggleLayer("cities")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                activeLayers.has("cities")
                  ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Users size={12} />
              Cities ({cityCount})
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw size={11} className={isFetching ? "animate-spin" : ""} />
            Live
          </div>
        </div>
      </div>

      {/* Map */}
      <div className="flex-1 relative">
        <div ref={containerRef} className="absolute inset-0" />

        {/* Incident type legend */}
        <div className="absolute bottom-6 left-4 z-[1000] bg-card/90 backdrop-blur border border-border rounded-xl p-3 shadow-xl">
          <p className="text-xs font-semibold text-muted-foreground mb-2 flex items-center gap-1.5">
            <Layers size={11} /> Incident types
          </p>
          <div className="space-y-1.5">
            {Object.entries(INCIDENT_COLORS).map(([type, color]) => (
              <div key={type} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
                <span className="text-xs text-muted-foreground capitalize">{type}</span>
              </div>
            ))}
          </div>
        </div>

        {/* No data state */}
        {incidentCount === 0 && cityCount === 0 && !isFetching && (
          <div className="absolute inset-0 flex items-center justify-center z-[999] pointer-events-none">
            <div className="bg-card/90 backdrop-blur border border-border rounded-2xl px-6 py-4 text-center shadow-xl">
              <MapPin size={32} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No map data yet</p>
              <p className="text-xs text-muted-foreground/60 mt-1">Incidents and city data will appear here</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
