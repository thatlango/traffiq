import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";

export interface IncidentType {
  key: string;
  label: string;
  icon: string;
  color: string;
  requiresPlate?: boolean;
}

export const INCIDENT_TYPES: IncidentType[] = [
  { key: "accident",      label: "Accident",            icon: "alert-circle",   color: Colors.danger,  requiresPlate: true },
  { key: "reckless",      label: "Reckless Driver",     icon: "alert-octagon",  color: Colors.danger,  requiresPlate: true },
  { key: "hit_run",       label: "Hit & Run",           icon: "wind",           color: Colors.danger,  requiresPlate: true },
  { key: "hazard",        label: "Road Hazard",         icon: "alert-triangle", color: Colors.warning },
  { key: "jam",           label: "Traffic Jam",         icon: "bar-chart-2",    color: Colors.info },
  { key: "police",        label: "Police Stop",         icon: "shield",         color: Colors.info },
  { key: "broken_light",  label: "Broken Light",        icon: "zap-off",        color: Colors.warning },
  { key: "flood",         label: "Flooding",            icon: "droplet",        color: Colors.info },
  { key: "pothole",       label: "Potholes",            icon: "layers",         color: Colors.warning },
  { key: "construction",  label: "Road Works",          icon: "tool",           color: Colors.warning },
];

interface Props {
  type: IncidentType;
  selected: boolean;
  onPress: () => void;
}

export default function IncidentCard({ type, selected, onPress }: Props) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scaleAnim, {
        toValue: selected ? 1.04 : 1,
        tension: 120, friction: 10,
        useNativeDriver: true,
      }),
      Animated.timing(glowAnim, {
        toValue: selected ? 1 : 0,
        duration: 200,
        useNativeDriver: false,
      }),
    ]).start();
  }, [selected]);

  const borderColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.border, type.color],
  });

  const bgColor = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [Colors.card, type.color + "20"],
  });

  return (
    <Pressable
      onPress={onPress}
      style={styles.wrapper}
    >
      <Animated.View style={[
        styles.card,
        { borderColor, backgroundColor: bgColor },
        selected && { shadowColor: type.color, shadowOpacity: 0.45, shadowRadius: 12, elevation: 6 },
      ]}>
        {/* Icon container */}
        <View style={[
          styles.iconRing,
          { backgroundColor: type.color + "1A" },
          selected && { backgroundColor: type.color + "2E" },
        ]}>
          <Feather name={type.icon as any} size={24} color={type.color} />
        </View>

        {/* Label */}
        <Text style={[styles.label, selected && { color: Colors.text, fontFamily: "Inter_600SemiBold" }]}>
          {type.label}
        </Text>

        {/* Plate badge */}
        {type.requiresPlate && (
          <View style={styles.plateBadge}>
            <Feather name="credit-card" size={9} color={Colors.warning} />
            <Text style={styles.plateBadgeText}>PLATE</Text>
          </View>
        )}

        {/* Check */}
        {selected && (
          <Animated.View style={[
            styles.check,
            { backgroundColor: type.color, transform: [{ scale: scaleAnim }] },
          ]}>
            <Feather name="check" size={11} color="#fff" />
          </Animated.View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "47%",
  },
  card: {
    alignItems: "center",
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 10,
    borderWidth: 1.5,
    gap: 9,
    position: "relative",
    shadowOffset: { width: 0, height: 4 },
  },
  iconRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.textSecondary,
    textAlign: "center",
    lineHeight: 16,
  },
  plateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: Colors.warning + "18",
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: Colors.warning + "33",
  },
  plateBadgeText: {
    fontFamily: "Inter_700Bold",
    fontSize: 9,
    color: Colors.warning,
    letterSpacing: 0.5,
  },
  check: {
    position: "absolute",
    top: 9,
    right: 9,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
  },
});
