import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import MapView, { Heatmap, Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useJourney } from "@/context/JourneyContext";
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

const KAMPALA_CENTER = { latitude: 0.3476, longitude: 32.5825 };

export default function TrafficMap({ filterType }: Props) {
  const mapRef = useRef<MapView>(null);
  const { currentLocation, currentJourney, smartPlaces } = useJourney();
  const [userReports, setUserReports] = useState<StoredReport[]>([]);

  useEffect(() => {
    loadReports();
    const interval = setInterval(loadReports, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const loadReports = async () => {
    try {
      const stored = await AsyncStorage.getItem(REPORTS_KEY);
      if (stored) {
        const reports: StoredReport[] = JSON.parse(stored);
        // Only show reports with GPS coords from last 3 hours
        const cutoff = Date.now() - 3 * 60 * 60 * 1000;
        setUserReports(reports.filter(r => r.latitude && r.longitude && r.timestamp > cutoff));
      }
    } catch {}
  };

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

  const visibleReports = filterType
    ? userReports.filter(r => r.type === filterType)
    : userReports;

  // Smart place markers
  const smartMarkers = smartPlaces.filter(p => p.latitude && p.longitude);

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
      initialRegion={{ ...KAMPALA_CENTER, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
      showsUserLocation
      showsMyLocationButton={false}
      showsTrafficEnabled
      userInterfaceStyle="dark"
    >
      {/* Traffic heatmap overlay */}
      <Heatmap
        points={[
          { latitude: 0.3476, longitude: 32.5825, weight: 1.0 },
          { latitude: 0.3490, longitude: 32.5832, weight: 0.8 },
          { latitude: 0.3460, longitude: 32.5810, weight: 0.9 },
          { latitude: 0.3500, longitude: 32.5850, weight: 0.7 },
          { latitude: 0.3420, longitude: 32.5800, weight: 0.6 },
          { latitude: 0.3450, longitude: 32.5870, weight: 0.85 },
        ]}
        opacity={0.6}
        radius={50}
        gradient={{ colors: ["#00ff00", "#ffff00", "#ff0000"], startPoints: [0.1, 0.5, 1.0], colorMapSize: 256 }}
      />

      {/* User-submitted incident markers with GPS */}
      {visibleReports.map(report => {
        const color = INCIDENT_COLORS[report.type] ?? Colors.warning;
        const icon = INCIDENT_ICONS[report.type] ?? "alert-triangle";
        return (
          <Marker
            key={report.id}
            coordinate={{ latitude: report.latitude!, longitude: report.longitude! }}
            title={report.type.replace("_", " ").toUpperCase()}
            description={[report.description, report.licensePlate ? `Plate: ${report.licensePlate}` : null].filter(Boolean).join(" · ")}
          >
            <View style={[styles.marker, { backgroundColor: color, borderColor: "#fff" }]}>
              <Feather name={icon as any} size={13} color="#fff" />
            </View>
          </Marker>
        );
      })}

      {/* Smart place markers (Home/Work/Frequent) */}
      {smartMarkers.map(place => (
        <Marker
          key={place.id}
          coordinate={{ latitude: place.latitude, longitude: place.longitude }}
          title={place.label}
          description={`Visited ${place.visitCount}x`}
        >
          <View style={[styles.smartMarker, { backgroundColor: place.color + "EE" }]}>
            <Feather name={place.icon as any} size={14} color="#fff" />
          </View>
        </Marker>
      ))}

      {/* Journey route polyline */}
      {currentJourney && currentJourney.route.length > 1 && (
        <Polyline
          coordinates={currentJourney.route.map(p => ({ latitude: p.latitude, longitude: p.longitude }))}
          strokeColor={Colors.accent}
          strokeWidth={4}
          lineDashPattern={undefined}
        />
      )}
    </MapView>
  );
}

const styles = StyleSheet.create({
  marker: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 3,
    elevation: 4,
  },
  smartMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2.5,
    borderColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
});
