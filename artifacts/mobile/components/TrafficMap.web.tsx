import React from "react";
import { Dimensions, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";

const { width } = Dimensions.get("window");

const DEMO_INCIDENTS = [
  { id: "1", type: "accident", x: 0.3, y: 0.45 },
  { id: "2", type: "jam", x: 0.65, y: 0.35 },
  { id: "3", type: "hazard", x: 0.2, y: 0.6 },
  { id: "4", type: "police", x: 0.7, y: 0.65 },
  { id: "5", type: "jam", x: 0.45, y: 0.25 },
];

const INCIDENT_COLORS: Record<string, string> = {
  accident: Colors.danger,
  jam: Colors.trafficRed,
  hazard: Colors.warning,
  police: Colors.info,
};

const INCIDENT_ICONS: Record<string, string> = {
  accident: "alert-circle",
  jam: "bar-chart-2",
  hazard: "alert-triangle",
  police: "shield",
};

export default function TrafficMap() {
  const mapHeight = Dimensions.get("window").height * 0.55;
  return (
    <View style={[styles.webMap, { height: mapHeight }]}>
      <View style={styles.mapRoad1} />
      <View style={styles.mapRoad2} />
      <View style={styles.mapRoadV1} />
      <View style={styles.mapRoadV2} />
      {DEMO_INCIDENTS.map(incident => (
        <View
          key={incident.id}
          style={[
            styles.webMarker,
            {
              left: incident.x * (width - 40),
              top: incident.y * mapHeight,
              backgroundColor: INCIDENT_COLORS[incident.type] ?? Colors.warning,
            }
          ]}
        >
          <Feather name={(INCIDENT_ICONS[incident.type] ?? "alert-triangle") as any} size={11} color="#fff" />
        </View>
      ))}
      <View style={styles.mapWatermark}>
        <Feather name="map" size={14} color={Colors.textMuted} />
        <Text style={styles.mapWatermarkText}>Kampala Live Traffic</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  webMap: {
    backgroundColor: "#0D1F38",
    width: "100%",
    position: "relative",
    overflow: "hidden",
  },
  mapRoad1: { position: "absolute", left: 0, right: 0, top: "40%", height: 6, backgroundColor: "rgba(255,255,255,0.07)" },
  mapRoad2: { position: "absolute", left: 0, right: 0, top: "65%", height: 4, backgroundColor: "rgba(255,255,255,0.05)" },
  mapRoadV1: { position: "absolute", top: 0, bottom: 0, left: "35%", width: 5, backgroundColor: "rgba(255,255,255,0.07)" },
  mapRoadV2: { position: "absolute", top: 0, bottom: 0, left: "68%", width: 4, backgroundColor: "rgba(255,255,255,0.05)" },
  webMarker: {
    position: "absolute",
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    marginLeft: -13,
    marginTop: -13,
  },
  mapWatermark: {
    position: "absolute",
    bottom: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  mapWatermarkText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
  },
});
