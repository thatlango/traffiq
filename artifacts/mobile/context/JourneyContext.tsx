import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Platform, Share } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TransportMode = "car" | "taxi" | "bus" | "truck" | "boda" | "bicycle" | "walking";
export type RiskLevel = "excellent" | "good" | "moderate" | "high";

export interface LocationPoint {
  latitude: number;
  longitude: number;
  speed: number;
  timestamp: number;
  accuracy: number;
}

export interface Journey {
  id: string;
  mode: TransportMode;
  startTime: number;
  endTime?: number;
  route: LocationPoint[];   // in-memory only (not persisted in full)
  maxSpeed: number;
  avgSpeed: number;
  distance: number;
  overspeedEvents: number;
  safetyScore: number;
}

/** Slimmed version written to AsyncStorage — no full route array */
interface StoredJourney {
  id: string;
  mode: TransportMode;
  startTime: number;
  endTime?: number;
  /** Compressed: only start, end, and every 10th point */
  routeSample: LocationPoint[];
  maxSpeed: number;
  avgSpeed: number;
  distance: number;
  overspeedEvents: number;
  safetyScore: number;
}

export interface SafetyAlert {
  id: string;
  type: "overspeed" | "harsh_braking" | "accident" | "hazard" | "congestion";
  message: string;
  timestamp: number;
  location?: { latitude: number; longitude: number };
}

export interface NextOfKin {
  id: string;
  name: string;
  phone: string;
}

export interface SmartPlace {
  id: string;
  label: "Home" | "Work" | "Frequent";
  latitude: number;
  longitude: number;
  visitCount: number;
  lastVisited: number;
  icon: string;
  color: string;
}

export interface FrequentRoute {
  id: string;
  startLabel: string;
  endLabel: string;
  count: number;
  avgDurationMin: number;
  mode: TransportMode;
  lastUsed: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

export const SPEED_LIMITS: Record<TransportMode, number> = {
  car: 50,
  taxi: 50,
  bus: 60,
  truck: 55,
  boda: 45,
  bicycle: 30,
  walking: 10,
};

const JOURNEYS_KEY    = "@traffiq_journeys";
const KIN_KEY         = "@traffiq_nextofkin";
const GEOCODE_THROTTLE_MS = 45_000;   // one reverse-geocode per 45 seconds max
const GEOCODE_MOVE_M  = 150;          // only re-geocode if moved > 150 m

// GPS: fire every 500 ms OR every 5 m movement — whichever comes first.
// 5 m distanceInterval = every logged point represents a real ≥5 m position change.
const GPS_OPTIONS: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 500,
  distanceInterval: 5,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineKm(lat1, lng1, lat2, lng2) * 1000;
}

function journeyToStored(j: Journey): StoredJourney {
  const { route, ...rest } = j;
  // Every point represents a real ≥5 m GPS change — store them all.
  return { ...rest, routeSample: route };
}

function storedToJourney(s: StoredJourney): Journey {
  const { routeSample, ...rest } = s;
  return { ...rest, route: routeSample };
}

function detectSmartPlaces(journeys: Journey[]): { places: SmartPlace[]; routes: FrequentRoute[] } {
  if (journeys.length === 0) return { places: [], routes: [] };

  const GRID = 0.003;
  const startClusters = new Map<string, { lat: number; lng: number; count: number; hours: number[]; lastVisited: number }>();
  const endClusters   = new Map<string, { lat: number; lng: number; count: number; hours: number[]; lastVisited: number }>();
  const routePairs    = new Map<string, { count: number; durations: number[]; mode: TransportMode; lastUsed: number }>();

  for (const j of journeys) {
    if (j.route.length < 2) continue;
    const start   = j.route[0];
    const end     = j.route[j.route.length - 1];
    const startH  = new Date(j.startTime).getHours();
    const endH    = j.endTime ? new Date(j.endTime).getHours() : startH;
    const durMin  = j.endTime ? (j.endTime - j.startTime) / 60000 : 0;

    const sk = `${(Math.round(start.latitude  / GRID) * GRID).toFixed(3)},${(Math.round(start.longitude / GRID) * GRID).toFixed(3)}`;
    const ek = `${(Math.round(end.latitude    / GRID) * GRID).toFixed(3)},${(Math.round(end.longitude   / GRID) * GRID).toFixed(3)}`;

    const sc = startClusters.get(sk) ?? { lat: start.latitude, lng: start.longitude, count: 0, hours: [], lastVisited: 0 };
    sc.count++; sc.hours.push(startH); sc.lastVisited = Math.max(sc.lastVisited, j.startTime);
    startClusters.set(sk, sc);

    const ec = endClusters.get(ek) ?? { lat: end.latitude, lng: end.longitude, count: 0, hours: [], lastVisited: 0 };
    ec.count++; ec.hours.push(endH); ec.lastVisited = Math.max(ec.lastVisited, j.endTime ?? j.startTime);
    endClusters.set(ek, ec);

    const rp = routePairs.get(`${sk}→${ek}`) ?? { count: 0, durations: [], mode: j.mode, lastUsed: 0 };
    rp.count++; rp.durations.push(durMin); rp.lastUsed = Math.max(rp.lastUsed, j.startTime);
    routePairs.set(`${sk}→${ek}`, rp);
  }

  // Combine clusters
  const allClusters = new Map<string, { lat: number; lng: number; startCount: number; endCount: number; morningHours: number[]; eveningHours: number[]; lastVisited: number }>();
  for (const [k, v] of startClusters) {
    const ex = allClusters.get(k) ?? { lat: v.lat, lng: v.lng, startCount: 0, endCount: 0, morningHours: [], eveningHours: [], lastVisited: 0 };
    ex.startCount += v.count;
    ex.morningHours.push(...v.hours.filter(h => h >= 5 && h <= 11));
    ex.lastVisited = Math.max(ex.lastVisited, v.lastVisited);
    allClusters.set(k, ex);
  }
  for (const [k, v] of endClusters) {
    const ex = allClusters.get(k) ?? { lat: v.lat, lng: v.lng, startCount: 0, endCount: 0, morningHours: [], eveningHours: [], lastVisited: 0 };
    ex.endCount += v.count;
    ex.eveningHours.push(...v.hours.filter(h => h >= 15 && h <= 22));
    ex.lastVisited = Math.max(ex.lastVisited, v.lastVisited);
    allClusters.set(k, ex);
  }

  const places: SmartPlace[] = [];
  let idx = 0;
  for (const [, c] of allClusters) {
    if (c.startCount + c.endCount < 2) continue;
    const morningStarts = c.morningHours.length;
    const eveningEnds   = c.eveningHours.length;
    let label: "Home" | "Work" | "Frequent" = "Frequent";
    let icon  = "map-pin";
    let color = "#8B5CF6";
    if (eveningEnds >= 2 && eveningEnds > morningStarts) { label = "Home"; icon = "home"; color = "#10B981"; }
    else if (morningStarts >= 2)                          { label = "Work"; icon = "briefcase"; color = "#3B82F6"; }
    places.push({ id: `sp${idx++}`, label, latitude: c.lat, longitude: c.lng, visitCount: c.startCount + c.endCount, lastVisited: c.lastVisited, icon, color });
  }

  const routes: FrequentRoute[] = [];
  let ri = 0;
  for (const [key, rp] of routePairs) {
    if (rp.count < 2) continue;
    const avg = rp.durations.reduce((a, b) => a + b, 0) / rp.durations.length;
    const [sk, ek] = key.split("→");
    routes.push({ id: `fr${ri++}`, startLabel: sk, endLabel: ek, count: rp.count, avgDurationMin: Math.round(avg), mode: rp.mode, lastUsed: rp.lastUsed });
  }

  return { places: places.slice(0, 5), routes: routes.slice(0, 5) };
}

// ─── Context shape ────────────────────────────────────────────────────────────

export interface JourneyContextValue {
  // Live (updates every GPS tick)
  isTracking: boolean;
  currentJourney: Journey | null;
  currentLocation: LocationPoint | null;
  currentSpeed: number;
  speedLimit: number;
  isOverspeed: boolean;
  alerts: SafetyAlert[];
  emergencyMode: boolean;
  currentRoadName: string | null;
  sharingJourney: boolean;
  // Stable
  pastJourneys: Journey[];
  safetyScore: number;
  riskLevel: RiskLevel;
  selectedMode: TransportMode;
  totalTrips: number;
  totalDistance: number;
  nextOfKin: NextOfKin[];
  smartPlaces: SmartPlace[];
  frequentRoutes: FrequentRoute[];
  // Actions
  setSelectedMode: (mode: TransportMode) => void;
  startJourney:   (mode: TransportMode) => Promise<void>;
  stopJourney:    () => Promise<void>;
  dismissAlert:   (id: string) => void;
  toggleEmergency:      () => void;
  addNextOfKin:         (contact: Omit<NextOfKin, "id">) => Promise<void>;
  removeNextOfKin:      (id: string) => Promise<void>;
  shareJourneyWithKin:  () => Promise<void>;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

const JourneyContext = createContext<JourneyContextValue | null>(null);

export function JourneyProvider({ children }: { children: React.ReactNode }) {
  // Live state
  const [isTracking,       setIsTracking]       = useState(false);
  const [currentJourney,   setCurrentJourney]   = useState<Journey | null>(null);
  const [currentLocation,  setCurrentLocation]  = useState<LocationPoint | null>(null);
  const [currentSpeed,     setCurrentSpeed]     = useState(0);
  const [alerts,           setAlerts]           = useState<SafetyAlert[]>([]);
  const [emergencyMode,    setEmergencyMode]    = useState(false);
  const [currentRoadName,  setCurrentRoadName]  = useState<string | null>(null);
  const [sharingJourney,   setSharingJourney]   = useState(false);

  // Stable state
  const [pastJourneys,   setPastJourneys]   = useState<Journey[]>([]);
  const [safetyScore,    setSafetyScore]    = useState(82);
  const [selectedMode,   setSelectedMode]   = useState<TransportMode>("car");
  const [nextOfKin,      setNextOfKin]      = useState<NextOfKin[]>([]);
  const [smartPlaces,    setSmartPlaces]    = useState<SmartPlace[]>([]);
  const [frequentRoutes, setFrequentRoutes] = useState<FrequentRoute[]>([]);

  // Refs (don't trigger re-renders)
  const locationSub        = useRef<Location.LocationSubscription | null>(null);
  const journeyRef         = useRef<Journey | null>(null);
  const overspeedTimer     = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodeTime    = useRef<number>(0);
  const lastGeocodePos     = useRef<{ lat: number; lng: number } | null>(null);
  const selectedModeRef    = useRef<TransportMode>("car");

  // Keep selectedModeRef in sync
  useEffect(() => { selectedModeRef.current = selectedMode; }, [selectedMode]);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [jRaw, kRaw] = await Promise.all([
          AsyncStorage.getItem(JOURNEYS_KEY),
          AsyncStorage.getItem(KIN_KEY),
        ]);
        if (kRaw) setNextOfKin(JSON.parse(kRaw));
        if (jRaw) {
          const stored: StoredJourney[] = JSON.parse(jRaw);
          const journeys = stored.map(storedToJourney);
          setPastJourneys(journeys);
          if (journeys.length > 0) {
            const avg = Math.round(journeys.reduce((a, j) => a + j.safetyScore, 0) / journeys.length);
            setSafetyScore(avg);
            const { places, routes } = detectSmartPlaces(journeys);
            setSmartPlaces(places);
            setFrequentRoutes(routes);
          }
        }
      } catch {}
    })();
  }, []);

  // ── Geocoding — cached + throttled ────────────────────────────────────────
  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    if (Platform.OS === "web") { setCurrentRoadName("Kampala Road"); return; }
    const now = Date.now();
    if (now - lastGeocodeTime.current < GEOCODE_THROTTLE_MS) return;
    // Skip if we haven't moved significantly
    const prev = lastGeocodePos.current;
    if (prev && haversineM(prev.lat, prev.lng, lat, lng) < GEOCODE_MOVE_M) return;
    lastGeocodeTime.current = now;
    lastGeocodePos.current  = { lat, lng };
    try {
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (results.length > 0) {
        const r = results[0];
        setCurrentRoadName(r.street ?? r.name ?? r.district ?? r.subregion ?? r.city ?? null);
      }
    } catch { setCurrentRoadName(null); }
  }, []);

  // ── Alert helper ──────────────────────────────────────────────────────────
  const addAlert = useCallback((alert: Omit<SafetyAlert, "id" | "timestamp">) => {
    setAlerts(prev => [
      { ...alert, id: Date.now().toString(), timestamp: Date.now() },
      ...prev,
    ].slice(0, 10));
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }, []);

  // ── Journey save (slim) ────────────────────────────────────────────────────
  const saveJourney = useCallback(async (journey: Journey) => {
    try {
      const raw = await AsyncStorage.getItem(JOURNEYS_KEY);
      const existing: StoredJourney[] = raw ? JSON.parse(raw) : [];
      const slim = journeyToStored(journey);
      const updated = [slim, ...existing].slice(0, 50);
      await AsyncStorage.setItem(JOURNEYS_KEY, JSON.stringify(updated));
      const fullJourneys = updated.map(storedToJourney);
      setPastJourneys(fullJourneys);
      const avg = Math.round(fullJourneys.reduce((a, j) => a + j.safetyScore, 0) / fullJourneys.length);
      setSafetyScore(avg);
      const { places, routes } = detectSmartPlaces(fullJourneys);
      setSmartPlaces(places);
      setFrequentRoutes(routes);
    } catch {}
  }, []);

  // ── Start journey ──────────────────────────────────────────────────────────
  const startJourney = useCallback(async (mode: TransportMode) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;

    const journey: Journey = {
      id: `${Date.now()}${Math.random().toString(36).slice(2, 7)}`,
      mode,
      startTime: Date.now(),
      route: [],
      maxSpeed: 0,
      avgSpeed: 0,
      distance: 0,
      overspeedEvents: 0,
      safetyScore: 100,
    };
    journeyRef.current = journey;
    setCurrentJourney({ ...journey });
    setIsTracking(true);
    setSelectedMode(mode);
    setCurrentRoadName(null);
    lastGeocodeTime.current = 0;
    lastGeocodePos.current  = null;

    const limit = SPEED_LIMITS[mode];

    locationSub.current = await Location.watchPositionAsync(
      GPS_OPTIONS,
      (loc) => {
        const rawKmh   = (loc.coords.speed ?? 0) * 3.6;
        const speedKmh = Math.max(0, rawKmh);
        const point: LocationPoint = {
          latitude:  loc.coords.latitude,
          longitude: loc.coords.longitude,
          speed:     speedKmh,
          timestamp: loc.timestamp,
          accuracy:  loc.coords.accuracy ?? 10,
        };

        // Update live UI state (batched in React 18)
        setCurrentLocation(point);
        setCurrentSpeed(speedKmh);

        // Geocode asynchronously — does NOT block GPS callback
        reverseGeocode(loc.coords.latitude, loc.coords.longitude);

        // Accumulate journey in ref (no setState = no re-render)
        const j = journeyRef.current;
        if (!j) return;

        const prev = j.route[j.route.length - 1];
        if (prev) j.distance += haversineKm(prev.latitude, prev.longitude, point.latitude, point.longitude);
        j.route.push(point);
        if (speedKmh > j.maxSpeed) j.maxSpeed = speedKmh;

        // Running average speed (lightweight)
        j.avgSpeed = j.avgSpeed + (speedKmh - j.avgSpeed) / j.route.length;

        if (speedKmh > limit) {
          j.overspeedEvents++;
          if (!overspeedTimer.current) {
            addAlert({ type: "overspeed", message: `Overspeeding! ${Math.round(speedKmh)} km/h (limit ${limit} km/h)` });
            overspeedTimer.current = setTimeout(() => { overspeedTimer.current = null; }, 8000);
          }
        }

        // Flush journey snapshot to state every 10 points (not every tick)
        if (j.route.length % 10 === 0) setCurrentJourney({ ...j });
      }
    );
  }, [addAlert, reverseGeocode]);

  // ── Stop journey ───────────────────────────────────────────────────────────
  const stopJourney = useCallback(async () => {
    locationSub.current?.remove();
    locationSub.current = null;
    if (overspeedTimer.current) { clearTimeout(overspeedTimer.current); overspeedTimer.current = null; }

    const j = journeyRef.current;
    if (j) {
      j.endTime     = Date.now();
      j.safetyScore = Math.max(30, 100 - Math.min(40, j.overspeedEvents * 5));
      await saveJourney(j);
    }

    setIsTracking(false);
    setCurrentJourney(null);
    journeyRef.current = null;
    setCurrentSpeed(0);
    setCurrentLocation(null);
    setCurrentRoadName(null);
    setSharingJourney(false);
  }, [saveJourney]);

  // ── Next of kin ────────────────────────────────────────────────────────────
  const addNextOfKin = useCallback(async (contact: Omit<NextOfKin, "id">) => {
    const entry: NextOfKin = { ...contact, id: `${Date.now()}${Math.random().toString(36).slice(2, 4)}` };
    setNextOfKin(prev => {
      const updated = [...prev, entry];
      AsyncStorage.setItem(KIN_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  const removeNextOfKin = useCallback(async (id: string) => {
    setNextOfKin(prev => {
      const updated = prev.filter(k => k.id !== id);
      AsyncStorage.setItem(KIN_KEY, JSON.stringify(updated));
      return updated;
    });
  }, []);

  // ── Share journey ──────────────────────────────────────────────────────────
  const shareJourneyWithKin = useCallback(async () => {
    const j   = journeyRef.current ?? currentJourney;
    const loc = lastGeocodePos.current;
    if (!j) return;
    const mapsLink  = loc ? `https://maps.google.com/?q=${loc.lat},${loc.lng}` : "";
    const roadPart  = currentRoadName ? `on ${currentRoadName}` : "";
    const speedPart = `at ${Math.round(currentSpeed)} km/h`;
    const message = [
      "TraffIQ Live Journey Update", "",
      `I am currently travelling ${roadPart} ${speedPart}.`,
      mapsLink,
      `Journey started: ${new Date(j.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      `Mode: ${j.mode.toUpperCase()}`,
      "", "Shared via TraffIQ — Uganda Road Safety Intelligence",
    ].filter(Boolean).join("\n");
    try {
      await Share.share({ message, title: "TraffIQ Live Journey" });
      setSharingJourney(true);
    } catch {}
  }, [currentJourney, currentRoadName, currentSpeed]);

  // ── Emergency ──────────────────────────────────────────────────────────────
  const toggleEmergency = useCallback(() => {
    setEmergencyMode(prev => {
      if (!prev) addAlert({ type: "accident", message: "Emergency mode activated. Sharing live location." });
      return !prev;
    });
  }, [addAlert]);

  // ── Derived (stable until deps change) ────────────────────────────────────
  const speedLimit   = SPEED_LIMITS[selectedMode];
  const isOverspeed  = currentSpeed > speedLimit;
  const riskLevel: RiskLevel =
    safetyScore >= 90 ? "excellent" : safetyScore >= 70 ? "good" : safetyScore >= 50 ? "moderate" : "high";
  const totalTrips   = pastJourneys.length;
  const totalDistance = pastJourneys.reduce((a, j) => a + j.distance, 0);

  // ── Memoized context value — stable part doesn't re-render when live changes
  const value = useMemo<JourneyContextValue>(() => ({
    isTracking, currentJourney, currentLocation, currentSpeed,
    speedLimit, isOverspeed, alerts, emergencyMode, currentRoadName, sharingJourney,
    pastJourneys, safetyScore, riskLevel, selectedMode, totalTrips, totalDistance,
    nextOfKin, smartPlaces, frequentRoutes,
    setSelectedMode, startJourney, stopJourney, dismissAlert,
    toggleEmergency, addNextOfKin, removeNextOfKin, shareJourneyWithKin,
  }), [
    isTracking, currentJourney, currentLocation, currentSpeed,
    speedLimit, isOverspeed, alerts, emergencyMode, currentRoadName, sharingJourney,
    pastJourneys, safetyScore, riskLevel, selectedMode, totalTrips, totalDistance,
    nextOfKin, smartPlaces, frequentRoutes,
    setSelectedMode, startJourney, stopJourney, dismissAlert,
    toggleEmergency, addNextOfKin, removeNextOfKin, shareJourneyWithKin,
  ]);

  return <JourneyContext.Provider value={value}>{children}</JourneyContext.Provider>;
}

export function useJourney() {
  const ctx = useContext(JourneyContext);
  if (!ctx) throw new Error("useJourney must be used within JourneyProvider");
  return ctx;
}
