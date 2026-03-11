import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
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

  const locationSubscription = useRef<Location.LocationSubscription | null>(null);
  const journeyRef = useRef<Journey | null>(null);
  const overspeedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    loadPastJourneys();
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

  const saveJourney = async (journey: Journey) => {
    try {
      const stored = await AsyncStorage.getItem("@roadwatch_journeys");
      const journeys: Journey[] = stored ? JSON.parse(stored) : [];
      const updated = [journey, ...journeys].slice(0, 50);
      await AsyncStorage.setItem("@roadwatch_journeys", JSON.stringify(updated));
      setPastJourneys(updated);
    } catch {}
  };

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
  }, [addAlert]);

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
  }, []);

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
