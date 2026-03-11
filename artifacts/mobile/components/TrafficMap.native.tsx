import React, { useEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import MapView, { Heatmap, Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { Feather } from "@expo/vector-icons";
import { useJourney } from "@/context/JourneyContext";
import Colors from "@/constants/colors";

const DEMO_HEATMAP = [
  { latitude: 0.3476, longitude: 32.5825, weight: 1.0 },
  { latitude: 0.3490, longitude: 32.5832, weight: 0.8 },
  { latitude: 0.3460, longitude: 32.5810, weight: 0.9 },
  { latitude: 0.3500, longitude: 32.5850, weight: 0.7 },
  { latitude: 0.3420, longitude: 32.5800, weight: 0.6 },
  { latitude: 0.3450, longitude: 32.5870, weight: 0.85 },
];

const NATIVE_INCIDENTS = [
  { id: "1", type: "accident", lat: 0.3476, lng: 32.5825, label: "Accident" },
  { id: "2", type: "jam", lat: 0.352, lng: 32.5860, label: "Congestion" },
  { id: "3", type: "hazard", lat: 0.3440, lng: 32.5800, label: "Hazard" },
  { id: "4", type: "police", lat: 0.3530, lng: 32.5810, label: "Police" },
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
  const mapRef = useRef<MapView>(null);
  const { currentLocation, currentJourney } = useJourney();

  useEffect(() => {
    if (currentLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
    }
  }, [currentLocation]);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
      initialRegion={{ latitude: 0.3476, longitude: 32.5825, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      showsUserLocation
      showsMyLocationButton={false}
      userInterfaceStyle="dark"
    >
      <Heatmap
        points={DEMO_HEATMAP.map(p => ({ latitude: p.latitude, longitude: p.longitude, weight: p.weight }))}
        opacity={0.7}
        radius={50}
        gradient={{ colors: ["#00ff00", "#ffff00", "#ff0000"], startPoints: [0.1, 0.5, 1.0], colorMapSize: 256 }}
      />
      {NATIVE_INCIDENTS.map(incident => (
        <Marker key={incident.id} coordinate={{ latitude: incident.lat, longitude: incident.lng }} title={incident.label}>
          <View style={[styles.markerDot, { backgroundColor: INCIDENT_COLORS[incident.type] ?? Colors.warning }]}>
            <Feather name={(INCIDENT_ICONS[incident.type] ?? "alert-triangle") as any} size={12} color="#fff" />
          </View>
        </Marker>
      ))}
      {currentJourney && currentJourney.route.length > 1 && (
        <Polyline
          coordinates={currentJourney.route.map(p => ({ latitude: p.latitude, longitude: p.longitude }))}
          strokeColor={Colors.accent}
          strokeWidth={4}
        />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  markerDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
  },
});
