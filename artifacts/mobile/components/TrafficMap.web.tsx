import React, { useEffect, useState } from "react";
import { Dimensions, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { REPORTS_KEY, StoredReport } from "@/app/(tabs)/report";
import Colors from "@/constants/colors";

interface Props {
  filterType?: string | null;
}

const INCIDENT_COLORS: Record<string, string> = {
  accident: Colors.danger,
  reckless: Colors.danger,
  hit_run: Colors.danger,
  jam: Colors.trafficRed,
  hazard: Colors.warning,
  police: Colors.info,
  broken_light: Colors.warning,
  flood: Colors.info,
  pothole: Colors.warning,
  construction: Colors.warning,
};

const INCIDENT_ICONS: Record<string, string> = {
  accident: "alert-circle",
  reckless: "alert-octagon",
  hit_run: "wind",
  jam: "bar-chart-2",
  hazard: "alert-triangle",
  police: "shield",
  broken_light: "zap-off",
  flood: "droplet",
  pothole: "layers",
  construction: "tool",
};

// Demo fallback incidents distributed around Kampala (for web preview)
const DEMO_INCIDENTS: StoredReport[] = [
  { id: "d1", type: "accident", description: "Collision at roundabout", timestamp: Date.now() - 600000, confirmed: 3, latitude: 0.349, longitude: 32.584 },
  { id: "d2", type: "jam", description: "Heavy traffic", timestamp: Date.now() - 900000, confirmed: 7, latitude: 0.352, longitude: 32.579 },
  { id: "d3", type: "hazard", description: "Fallen tree", timestamp: Date.now() - 1200000, confirmed: 2, latitude: 0.344, longitude: 32.588 },
  { id: "d4", type: "police", description: "Checkpoint", timestamp: Date.now() - 300000, confirmed: 5, latitude: 0.355, longitude: 32.582 },
  { id: "d5", type: "pothole", description: "Large potholes", timestamp: Date.now() - 1800000, confirmed: 4, latitude: 0.341, longitude: 32.576 },
];

// Map Kampala area to canvas coordinates
const LAT_MIN = 0.330, LAT_MAX = 0.370;
const LNG_MIN = 32.565, LNG_MAX = 32.600;

function toCanvasX(lng: number, w: number) {
  return ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * w;
}
function toCanvasY(lat: number, h: number) {
  return (1 - (lat - LAT_MIN) / (LAT_MAX - LAT_MIN)) * h;
}

export default function TrafficMap({ filterType }: Props) {
  const { width } = Dimensions.get("window");
  const mapHeight = Dimensions.get("window").height * 0.55;
  const [userReports, setUserReports] = useState<StoredReport[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    try {
      const stored = await AsyncStorage.getItem(REPORTS_KEY);
      if (stored) {
        const reports: StoredReport[] = JSON.parse(stored);
        const cutoff = Date.now() - 6 * 60 * 60 * 1000;
        const withGps = reports.filter(r => r.latitude && r.longitude && r.timestamp > cutoff);
        setUserReports(withGps.length > 0 ? withGps : DEMO_INCIDENTS);
      } else {
        setUserReports(DEMO_INCIDENTS);
      }
    } catch {
      setUserReports(DEMO_INCIDENTS);
    }
  };

  const visibleReports = filterType
    ? userReports.filter(r => r.type === filterType)
    : userReports;

  return (
    <View style={[styles.mapContainer, { height: mapHeight }]}>
      {/* Road grid - Kampala style */}
      <View style={styles.roadH1} />
      <View style={styles.roadH2} />
      <View style={styles.roadH3} />
      <View style={styles.roadV1} />
      <View style={styles.roadV2} />
      <View style={styles.roadV3} />

      {/* Traffic colour bands */}
      <View style={[styles.trafficBand, { top: "38%", height: 7, backgroundColor: "#FF443322", left: "0%", right: "40%" }]} />
      <View style={[styles.trafficBand, { top: "38%", height: 7, backgroundColor: "#10B98122", left: "40%", right: "0%" }]} />
      <View style={[styles.trafficBand, { top: "63%", height: 5, backgroundColor: "#F59E0B22", left: "0%", right: "0%" }]} />

      {/* Incident markers */}
      {visibleReports.map(report => {
        const lat = report.latitude ?? 0.348;
        const lng = report.longitude ?? 32.582;
        const x = toCanvasX(lng, width - 32);
        const y = toCanvasY(lat, mapHeight);
        const color = INCIDENT_COLORS[report.type] ?? Colors.warning;
        const icon = INCIDENT_ICONS[report.type] ?? "alert-triangle";
        const isSelected = selected === report.id;

        return (
          <Pressable
            key={report.id}
            onPress={() => setSelected(isSelected ? null : report.id)}
            style={[styles.marker, {
              left: x - 14,
              top: y - 14,
              backgroundColor: color,
              transform: [{ scale: isSelected ? 1.25 : 1 }],
            }]}
          >
            <Feather name={icon as any} size={12} color="#fff" />
          </Pressable>
        );
      })}

      {/* Detail popup for selected marker */}
      {selected && (() => {
        const r = visibleReports.find(r => r.id === selected);
        if (!r) return null;
        const color = INCIDENT_COLORS[r.type] ?? Colors.warning;
        const minsAgo = Math.round((Date.now() - r.timestamp) / 60000);
        return (
          <View style={[styles.popup, { borderColor: color + "88" }]}>
            <Text style={[styles.popupType, { color }]}>{r.type.replace("_", " ").toUpperCase()}</Text>
            {r.description ? <Text style={styles.popupDesc}>{r.description}</Text> : null}
            {r.licensePlate ? <Text style={styles.popupPlate}>🚗 {r.licensePlate}</Text> : null}
            <Text style={styles.popupMeta}>
              {minsAgo < 1 ? "Just now" : `${minsAgo}m ago`}
              {r.latitude ? ` · ${r.latitude.toFixed(4)}, ${r.longitude?.toFixed(4)}` : ""}
              {r.confirmed > 0 ? ` · ${r.confirmed} confirmed` : ""}
            </Text>
          </View>
        );
      })()}

      {/* Map watermark */}
      <View style={styles.watermark}>
        <Feather name="map" size={13} color={Colors.textMuted} />
        <Text style={styles.watermarkText}>Kampala · Live Traffic</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapContainer: { backgroundColor: "#0D1F38", width: "100%", position: "relative", overflow: "hidden" },
  roadH1: { position: "absolute", left: 0, right: 0, top: "40%", height: 7, backgroundColor: "rgba(255,255,255,0.09)" },
  roadH2: { position: "absolute", left: 0, right: 0, top: "65%", height: 5, backgroundColor: "rgba(255,255,255,0.06)" },
  roadH3: { position: "absolute", left: 0, right: 0, top: "20%", height: 4, backgroundColor: "rgba(255,255,255,0.04)" },
  roadV1: { position: "absolute", top: 0, bottom: 0, left: "35%", width: 6, backgroundColor: "rgba(255,255,255,0.09)" },
  roadV2: { position: "absolute", top: 0, bottom: 0, left: "68%", width: 5, backgroundColor: "rgba(255,255,255,0.06)" },
  roadV3: { position: "absolute", top: 0, bottom: 0, left: "15%", width: 4, backgroundColor: "rgba(255,255,255,0.04)" },
  trafficBand: { position: "absolute" },
  marker: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 4,
  },
  popup: {
    position: "absolute",
    bottom: 70,
    left: 16,
    right: 16,
    backgroundColor: "rgba(10,22,40,0.97)",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1.5,
    gap: 4,
  },
  popupType: { fontFamily: "Inter_700Bold", fontSize: 13, letterSpacing: 0.5 },
  popupDesc: { fontFamily: "Inter_400Regular", fontSize: 13, color: Colors.text },
  popupPlate: { fontFamily: "Inter_700Bold", fontSize: 14, color: Colors.warning, letterSpacing: 2 },
  popupMeta: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  watermark: {
    position: "absolute", bottom: 10, right: 12,
    flexDirection: "row", alignItems: "center", gap: 5,
  },
  watermarkText: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textMuted },
});
