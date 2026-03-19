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

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const journeyRef = useRef<Journey | null>(null);
  const overspeedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const geocodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGeocodeTime = useRef<number>(0);

  useEffect(() => {
    loadPastJourneys();
    loadNextOfKin();
  }, []);

  const loadPastJourneys = async () => {
    try {
      const stored = await AsyncStorage.getItem("@roadwatch_journeys");
      if (stored) {
        const journeys: Journey[] = JSON.parse(stored);
        setPastJourneys(journeys);
        if (journeys.length > 0) {
          const totalScore = journeys.reduce((acc, j) => acc + j.safetyScore, 0);
          setSafetyScore(Math.round(totalScore / journeys.length));
        }
      }
    } catch {}
  };

  const loadNextOfKin = async () => {
    try {
      const stored = await AsyncStorage.getItem("@roadwatch_nextofkin");
      if (stored) setNextOfKin(JSON.parse(stored));
    } catch {}
  };

  const saveJourney = async (journey: Journey) => {
    try {
      const stored = await AsyncStorage.getItem("@roadwatch_journeys");
      const journeys: Journey[] = stored ? JSON.parse(stored) : [];
      const updated = [journey, ...journeys].slice(0, 50);
      await AsyncStorage.setItem("@roadwatch_journeys", JSON.stringify(updated));
      setPastJourneys(updated);
    } catch {}
  };

  const addNextOfKin = useCallback(async (contact: Omit<NextOfKin, "id">) => {
    const newContact: NextOfKin = {
      ...contact,
      id: Date.now().toString() + Math.random().toString(36).substr(2, 4),
    };
    const updated = [...nextOfKin, newContact];
    setNextOfKin(updated);
    await AsyncStorage.setItem("@roadwatch_nextofkin", JSON.stringify(updated));
  }, [nextOfKin]);

  const removeNextOfKin = useCallback(async (id: string) => {
    const updated = nextOfKin.filter(k => k.id !== id);
    setNextOfKin(updated);
    await AsyncStorage.setItem("@roadwatch_nextofkin", JSON.stringify(updated));
  }, [nextOfKin]);

  const reverseGeocode = useCallback(async (lat: number, lng: number) => {
    const now = Date.now();
    if (now - lastGeocodeTime.current < 20000) return; // throttle to every 20s
    lastGeocodeTime.current = now;
    try {
      if (Platform.OS === "web") {
        // Fallback for web — use a dummy road name based on coords
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
    const newAlert: SafetyAlert = {
      ...alert,
      id: Date.now().toString(),
      timestamp: Date.now(),
    };
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

        // Reverse geocode to get road name (throttled)
        reverseGeocode(loc.coords.latitude, loc.coords.longitude);

        if (journeyRef.current) {
          const j = journeyRef.current;
          j.route.push(point);
          if (speedKmh > j.maxSpeed) j.maxSpeed = speedKmh;
          const total = j.route.reduce((s, p) => s + p.speed, 0);
          j.avgSpeed = total / j.route.length;

          if (speedKmh > limit) {
            j.overspeedEvents++;
            if (overspeedTimerRef.current === null) {
              addAlert({ type: "overspeed", message: `Overspeeding! ${Math.round(speedKmh)} km/h (limit: ${limit} km/h)` });
              overspeedTimerRef.current = setTimeout(() => {
                overspeedTimerRef.current = null;
              }, 8000);
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
    const kinNames = nextOfKin.map(k => k.name).join(", ");
    const speedPart = `at ${Math.round(currentSpeed)} km/h`;
    const mapsLink = loc
      ? `https://maps.google.com/?q=${loc.latitude},${loc.longitude}`
      : "";

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
      addAlert({ type: "congestion", message: `Journey shared${kinNames ? ` with ${kinNames}` : ""}.` });
    } catch {}
  }, [currentJourney, currentLocation, currentRoadName, currentSpeed, nextOfKin, addAlert]);

  const toggleEmergency = useCallback(() => {
    setEmergencyMode((prev) => {
      if (!prev) {
        addAlert({ type: "accident", message: "Emergency mode activated. Sharing live location." });
      }
      return !prev;
    });
  }, [addAlert]);

  return (
    <JourneyContext.Provider
      value={{
        isTracking,
        currentJourney,
        currentLocation,
        currentSpeed,
        speedLimit,
        isOverspeed,
        alerts,
        pastJourneys,
        safetyScore,
        riskLevel,
        selectedMode,
        setSelectedMode,
        startJourney,
        stopJourney,
        dismissAlert,
        emergencyMode,
        toggleEmergency,
        totalTrips,
        totalDistance,
        currentRoadName,
        nextOfKin,
        addNextOfKin,
        removeNextOfKin,
        sharingJourney,
        shareJourneyWithKin,
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
