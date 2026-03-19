import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import { Share, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

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
  route: LocationPoint[];
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

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function detectSmartPlaces(journeys: Journey[]): { places: SmartPlace[]; routes: FrequentRoute[] } {
  if (journeys.length === 0) return { places: [], routes: [] };

  const GRID = 0.003; // ~300m cluster radius
  const startClusters: Map<string, { lat: number; lng: number; count: number; hours: number[]; lastVisited: number }> = new Map();
  const endClusters: Map<string, { lat: number; lng: number; count: number; hours: number[]; lastVisited: number }> = new Map();
  const routePairs: Map<string, { count: number; durations: number[]; mode: TransportMode; lastUsed: number }> = new Map();

  for (const j of journeys) {
    if (j.route.length < 2) continue;
    const start = j.route[0];
    const end = j.route[j.route.length - 1];
    const startHour = new Date(j.startTime).getHours();
    const endHour = j.endTime ? new Date(j.endTime).getHours() : startHour;
    const durationMin = j.endTime ? (j.endTime - j.startTime) / 60000 : 0;

    const sk = `${(Math.round(start.latitude / GRID) * GRID).toFixed(3)},${(Math.round(start.longitude / GRID) * GRID).toFixed(3)}`;
    const ek = `${(Math.round(end.latitude / GRID) * GRID).toFixed(3)},${(Math.round(end.longitude / GRID) * GRID).toFixed(3)}`;

    const sc = startClusters.get(sk) ?? { lat: start.latitude, lng: start.longitude, count: 0, hours: [], lastVisited: 0 };
    sc.count++;
    sc.hours.push(startHour);
    sc.lastVisited = Math.max(sc.lastVisited, j.startTime);
    startClusters.set(sk, sc);

    const ec = endClusters.get(ek) ?? { lat: end.latitude, lng: end.longitude, count: 0, hours: [], lastVisited: 0 };
    ec.count++;
    ec.hours.push(endHour);
    ec.lastVisited = Math.max(ec.lastVisited, j.endTime ?? j.startTime);
    endClusters.set(ek, ec);

    const routeKey = `${sk}→${ek}`;
    const rp = routePairs.get(routeKey) ?? { count: 0, durations: [], mode: j.mode, lastUsed: 0 };
    rp.count++;
    rp.durations.push(durationMin);
    rp.lastUsed = Math.max(rp.lastUsed, j.startTime);
    routePairs.set(routeKey, rp);
  }

  // Combine start + end clusters
  const allClusters = new Map<string, { lat: number; lng: number; startCount: number; endCount: number; morningHours: number[]; eveningHours: number[]; lastVisited: number }>();

  for (const [k, v] of startClusters) {
    const ex = allClusters.get(k) ?? { lat: v.lat, lng: v.lng, startCount: 0, endCount: 0, morningHours: [], eveningHours: [], lastVisited: 0 };
    ex.startCount += v.count;
    ex.morningHours.push(...v.hours.filter(h => h >= 5 && h <= 11));
    ex.eveningHours.push(...v.hours.filter(h => h >= 16 && h <= 23));
    ex.lastVisited = Math.max(ex.lastVisited, v.lastVisited);
    allClusters.set(k, ex);
  }
  for (const [k, v] of endClusters) {
    const ex = allClusters.get(k) ?? { lat: v.lat, lng: v.lng, startCount: 0, endCount: 0, morningHours: [], eveningHours: [], lastVisited: 0 };
    ex.endCount += v.count;
    ex.morningHours.push(...v.hours.filter(h => h >= 5 && h <= 11));
    ex.eveningHours.push(...v.hours.filter(h => h >= 16 && h <= 23));
    ex.lastVisited = Math.max(ex.lastVisited, v.lastVisited);
    allClusters.set(k, ex);
  }

  const sorted = Array.from(allClusters.entries())
    .map(([k, v]) => ({ k, ...v, total: v.startCount + v.endCount }))
    .sort((a, b) => b.total - a.total);

  const places: SmartPlace[] = [];
  let homeAssigned = false;
  let workAssigned = false;

  for (const c of sorted.slice(0, 5)) {
    const isLikelyHome = c.eveningHours.length > c.morningHours.length;
    let label: "Home" | "Work" | "Frequent";
    let icon: string;
    let color: string;

    if (!homeAssigned && isLikelyHome) {
      label = "Home"; icon = "home"; color = "#10B981"; homeAssigned = true;
    } else if (!workAssigned && !isLikelyHome) {
      label = "Work"; icon = "briefcase"; color = "#3B82F6"; workAssigned = true;
    } else {
      label = "Frequent"; icon = "map-pin"; color = "#F59E0B";
    }

    places.push({
      id: c.k,
      label,
      latitude: c.lat,
      longitude: c.lng,
      visitCount: c.total,
      lastVisited: c.lastVisited,
      icon,
      color,
    });
  }

  const routes: FrequentRoute[] = Array.from(routePairs.entries())
    .filter(([, v]) => v.count >= 2)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([key, v], i) => {
      const avgDur = v.durations.reduce((a, b) => a + b, 0) / v.durations.length;
      const parts = key.split("→");
      return {
        id: key,
        startLabel: `Start ${i + 1}`,
        endLabel: `End ${i + 1}`,
        count: v.count,
        avgDurationMin: Math.round(avgDur),
        mode: v.mode,
        lastUsed: v.lastUsed,
      };
    });

  return { places, routes };
}

interface JourneyContextValue {
  isTracking: boolean;
  currentJourney: Journey | null;
  currentLocation: LocationPoint | null;
  currentSpeed: number;
  speedLimit: number;
  isOverspeed: boolean;
  alerts: SafetyAlert[];
  pastJourneys: Journey[];
  safetyScore: number;
  riskLevel: RiskLevel;
  selectedMode: TransportMode;
  setSelectedMode: (mode: TransportMode) => void;
  startJourney: (mode: TransportMode) => Promise<void>;
  stopJourney: () => Promise<void>;
  dismissAlert: (id: string) => void;
  emergencyMode: boolean;
  toggleEmergency: () => void;
  totalTrips: number;
  totalDistance: number;
  currentRoadName: string | null;
  nextOfKin: NextOfKin[];
  addNextOfKin: (contact: Omit<NextOfKin, "id">) => Promise<void>;
  removeNextOfKin: (id: string) => Promise<void>;
  sharingJourney: boolean;
  shareJourneyWithKin: () => Promise<void>;
  smartPlaces: SmartPlace[];
  frequentRoutes: FrequentRoute[];
}

const SPEED_LIMITS: Record<TransportMode, number> = {
  car: 50,
  taxi: 50,
  bus: 60,
  truck: 55,
  boda: 45,
  bicycle: 30,
  walking: 10,
};

const JourneyContext = createContext<JourneyContextValue | null>(null);

export function JourneyProvider({ children }: { children: React.ReactNode }) {
  const [isTracking, setIsTracking] = useState(false);
  const [currentJourney, setCurrentJourney] = useState<Journey | null>(null);
  const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);
  const [currentSpeed, setCurrentSpeed] = useState(0);
  const [alerts, setAlerts] = useState<SafetyAlert[]>([]);
  const [pastJourneys, setPastJourneys] = useState<Journey[]>([]);
  const [safetyScore, setSafetyScore] = useState(82);
  const [selectedMode, setSelectedMode] = useState<TransportMode>("car");
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [currentRoadName, setCurrentRoadName] = useState<string | null>(null);
  const [nextOfKin, setNextOfKin] = useState<NextOfKin[]>([]);
  const [sharingJourney, setSharingJourney] = useState(false);
  const [smartPlaces, setSmartPlaces] = useState<SmartPlace[]>([]);
  const [frequentRoutes, setFrequentRoutes] = useState<FrequentRoute[]>([]);

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const journeyRef = useRef<Journey | null>(null);
  const overspeedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodeTime = useRef<number>(0);

  useEffect(() => {
    loadPastJourneys();
    loadNextOfKin();
  }, []);

  const loadPastJourneys = async () => {
    try {
      const stored = await AsyncStorage.getItem("@traffiq_journeys");
      if (stored) {
        const journeys: Journey[] = JSON.parse(stored);
        setPastJourneys(journeys);
        if (journeys.length > 0) {
          const totalScore = journeys.reduce((acc, j) => acc + j.safetyScore, 0);
          setSafetyScore(Math.round(totalScore / journeys.length));
          const { places, routes } = detectSmartPlaces(journeys);
          setSmartPlaces(places);
          setFrequentRoutes(routes);
        }
      }
    } catch {}
  };

  const loadNextOfKin = async () => {
    try {
      const stored = await AsyncStorage.getItem("@traffiq_nextofkin");
      if (stored) setNextOfKin(JSON.parse(stored));
    } catch {}
  };

  const saveJourney = async (journey: Journey) => {
    try {
      const stored = await AsyncStorage.getItem("@traffiq_journeys");
      const journeys: Journey[] = stored ? JSON.parse(stored) : [];
      const updated = [journey, ...journeys].slice(0, 50);
      await AsyncStorage.setItem("@traffiq_journeys", JSON.stringify(updated));
      setPastJourneys(updated);
      const { places, routes } = detectSmartPlaces(updated);
      setSmartPlaces(places);
      setFrequentRoutes(routes);
    } catch {}
  };

  const addNextOfKin = useCallback(async (contact: Omit<NextOfKin, "id">) => {
    const newContact: NextOfKin = {
      ...contact,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
    };
    const updated = [...nextOfKin, newContact];
    setNextOfKin(updated);
    await AsyncStorage.setItem("@traffiq_nextofkin", JSON.stringify(updated));
  }, [nextOfKin]);

  const removeNextOfKin = useCallback(async (id: string) => {
    const updated = nextOfKin.filter(k => k.id !== id);
    setNextOfKin(updated);
    await AsyncStorage.setItem("@traffiq_nextofkin", JSON.stringify(updated));
  }, [nextOfKin]);

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    const now = Date.now();
    if (now - lastGeocodeTime.current < 20000) return;
    lastGeocodeTime.current = now;
    try {
      if (Platform.OS === "web") {
        setCurrentRoadName("Kampala Road");
        return;
      }
      const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
      if (results.length > 0) {
        const r = results[0];
        const road = r.street ?? r.name ?? r.district ?? r.subregion ?? r.city ?? null;
        setCurrentRoadName(road);
      }
    } catch {
      setCurrentRoadName(null);
    }
  }, []);

  const speedLimit = SPEED_LIMITS[selectedMode];
  const isOverspeed = currentSpeed > speedLimit;
  const riskLevel: RiskLevel =
    safetyScore >= 90 ? "excellent" : safetyScore >= 70 ? "good" : safetyScore >= 50 ? "moderate" : "high";
  const totalTrips = pastJourneys.length;
  const totalDistance = pastJourneys.reduce((acc, j) => acc + j.distance, 0);

  const addAlert = useCallback((alert: Omit<SafetyAlert, "id" | "timestamp">) => {
    const newAlert: SafetyAlert = { ...alert, id: Date.now().toString(), timestamp: Date.now() };
    setAlerts((prev) => [newAlert, ...prev].slice(0, 10));
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const startJourney = useCallback(async (mode: TransportMode) => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return;

    const limit = SPEED_LIMITS[mode];
    const journey: Journey = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
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
    setCurrentJourney(journey);
    setIsTracking(true);
    setSelectedMode(mode);
    setCurrentRoadName(null);
    lastGeocodeTime.current = 0;

    locationSubscription.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.BestForNavigation,
        timeInterval: 1500,
        distanceInterval: 5,
      },
      (loc) => {
        const speedKmh = (loc.coords.speed ?? 0) * 3.6;
        const point: LocationPoint = {
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
          speed: speedKmh,
          timestamp: loc.timestamp,
          accuracy: loc.coords.accuracy ?? 10,
        };
        setCurrentLocation(point);
        setCurrentSpeed(Math.max(0, speedKmh));
        reverseGeocode(loc.coords.latitude, loc.coords.longitude);

        if (journeyRef.current) {
          const j = journeyRef.current;
          const prev = j.route[j.route.length - 1];
          if (prev) {
            j.distance += haversineKm(prev.latitude, prev.longitude, point.latitude, point.longitude);
          }
          j.route.push(point);
          if (speedKmh > j.maxSpeed) j.maxSpeed = speedKmh;
          const total = j.route.reduce((s, p) => s + p.speed, 0);
          j.avgSpeed = total / j.route.length;

          if (speedKmh > limit) {
            j.overspeedEvents++;
            if (overspeedTimerRef.current === null) {
              addAlert({ type: "overspeed", message: `Overspeeding! ${Math.round(speedKmh)} km/h (limit: ${limit} km/h)` });
              overspeedTimerRef.current = setTimeout(() => { overspeedTimerRef.current = null; }, 8000);
            }
          }
        }
      }
    );
  }, [addAlert, reverseGeocode]);

  const stopJourney = useCallback(async () => {
    if (locationSubscription.current) {
      locationSubscription.current.remove();
      locationSubscription.current = null;
    }
    if (overspeedTimerRef.current) {
      clearTimeout(overspeedTimerRef.current);
      overspeedTimerRef.current = null;
    }

    if (journeyRef.current) {
      const j = journeyRef.current;
      j.endTime = Date.now();
      const penalty = Math.min(40, j.overspeedEvents * 5);
      j.safetyScore = Math.max(30, 100 - penalty);
      await saveJourney(j);
      setSafetyScore((prev) => Math.round((prev + j.safetyScore) / 2));
    }

    setIsTracking(false);
    setCurrentJourney(null);
    journeyRef.current = null;
    setCurrentSpeed(0);
    setCurrentRoadName(null);
    setSharingJourney(false);
  }, []);

  const shareJourneyWithKin = useCallback(async () => {
    if (!currentJourney) return;
    const loc = currentLocation;
    const roadPart = currentRoadName ? `on ${currentRoadName}` : "";
    const speedPart = `at ${Math.round(currentSpeed)} km/h`;
    const mapsLink = loc ? `https://maps.google.com/?q=${loc.latitude},${loc.longitude}` : "";

    const message = [
      `TraffIQ Live Journey Update`,
      ``,
      `I am currently travelling ${roadPart} ${speedPart}.`,
      loc ? `Live location: ${mapsLink}` : "",
      ``,
      `Journey started: ${new Date(currentJourney.startTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
      `Transport mode: ${currentJourney.mode.toUpperCase()}`,
      ``,
      `Shared via TraffIQ — Uganda Road Safety Intelligence`,
    ].filter(Boolean).join("\n");

    try {
      await Share.share({ message, title: "TraffIQ Live Journey" });
      setSharingJourney(true);
      addAlert({ type: "congestion", message: `Journey shared.` });
    } catch {}
  }, [currentJourney, currentLocation, currentRoadName, currentSpeed, addAlert]);

  const toggleEmergency = useCallback(() => {
    setEmergencyMode((prev) => {
      if (!prev) addAlert({ type: "accident", message: "Emergency mode activated. Sharing live location." });
      return !prev;
    });
  }, [addAlert]);

  return (
    <JourneyContext.Provider
      value={{
        isTracking, currentJourney, currentLocation, currentSpeed,
        speedLimit, isOverspeed, alerts, pastJourneys, safetyScore,
        riskLevel, selectedMode, setSelectedMode, startJourney, stopJourney,
        dismissAlert, emergencyMode, toggleEmergency, totalTrips, totalDistance,
        currentRoadName, nextOfKin, addNextOfKin, removeNextOfKin,
        sharingJourney, shareJourneyWithKin, smartPlaces, frequentRoutes,
      }}
    >
      {children}
    </JourneyContext.Provider>
  );
}

export function useJourney() {
  const ctx = useContext(JourneyContext);
  if (!ctx) throw new Error("useJourney must be used within JourneyProvider");
  return ctx;
}
