import React, { useEffect, useRef } from "react";
import {
  Animated,
  Platform,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useJourney } from "@/context/JourneyContext";
import TrafficMap from "@/components/TrafficMap";
import Colors from "@/constants/colors";

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const topInset = Platform.OS === "web" ? 67 : insets.top;
  const { emergencyMode } = useJourney();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (emergencyMode) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [emergencyMode]);

  return (
    <View style={styles.container}>
      <TrafficMap />

      {/* Header overlay */}
      <View style={[styles.header, { paddingTop: topInset + 8 }]}>
        <View style={styles.headerLeft}>
          <View style={styles.logoRow}>
            <Feather name="shield" size={20} color={Colors.accent} />
            <Text style={styles.logoText}>TraffIQ</Text>
          </View>
          <Text style={styles.headerSubtitle}>Live Traffic Intelligence</Text>
        </View>
        <View style={styles.liveChip}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {emergencyMode && (
        <Animated.View style={[styles.emergencyBanner, { transform: [{ scale: pulseAnim }] }]}>
          <Feather name="radio" size={14} color="#fff" />
          <Text style={styles.emergencyText}>EMERGENCY MODE ACTIVE</Text>
        </Animated.View>
      )}

      {/* Legend */}
      <View style={styles.legend}>
        {[
          { color: Colors.trafficGreen, label: "Clear" },
          { color: Colors.warning, label: "Moderate" },
          { color: Colors.trafficRed, label: "Heavy" },
          { color: Colors.danger, label: "Incident" },
        ].map(item => (
          <View key={item.label} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: item.color }]} />
            <Text style={styles.legendLabel}>{item.label}</Text>
          </View>
        ))}
      </View>

      {/* Live stats strip */}
      <View style={[styles.statsStrip, { marginBottom: Platform.OS === "web" ? 34 : 8 }]}>
        {[
          { value: "1,247", label: "Active Users", color: Colors.text },
          { value: "18", label: "Incidents", color: Colors.warning },
          { value: "6", label: "Overspeed", color: Colors.danger },
          { value: "Good", label: "Road Safety", color: Colors.success },
        ].map((stat, i, arr) => (
          <React.Fragment key={stat.label}>
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: stat.color }]}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
            {i < arr.length - 1 && <View style={styles.statDivider} />}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: "rgba(10,22,40,0.90)",
  },
  headerLeft: { gap: 2 },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  logoText: { fontFamily: "Inter_700Bold", fontSize: 20, color: Colors.text, letterSpacing: -0.5 },
  headerSubtitle: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary },
  liveChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.danger + "22",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.danger + "55",
    marginTop: 4,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.danger },
  liveText: { fontFamily: "Inter_700Bold", fontSize: 11, color: Colors.danger, letterSpacing: 1 },
  emergencyBanner: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: Colors.danger,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
    marginTop: 8,
  },
  emergencyText: { fontFamily: "Inter_700Bold", fontSize: 13, color: "#fff", letterSpacing: 1 },
  legend: {
    position: "absolute",
    bottom: 180,
    right: 16,
    backgroundColor: "rgba(10,22,40,0.92)",
    borderRadius: 14,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 8 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendLabel: { fontFamily: "Inter_400Regular", fontSize: 11, color: Colors.textSecondary },
  statsStrip: {
    position: "absolute",
    bottom: 90,
    left: 16,
    right: 16,
    backgroundColor: "rgba(10,22,40,0.94)",
    borderRadius: 18,
    flexDirection: "row",
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statItem: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { fontFamily: "Inter_700Bold", fontSize: 18, color: Colors.text },
  statLabel: { fontFamily: "Inter_400Regular", fontSize: 10, color: Colors.textSecondary },
  statDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 4 },
});
