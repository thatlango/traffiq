import React from "react";
import { StyleSheet, Text, View, Pressable } from "react-native";
import { Feather } from "@expo/vector-icons";
import Colors from "@/constants/colors";

interface IncidentType {
  key: string;
  label: string;
  icon: string;
  color: string;
}

export const INCIDENT_TYPES: IncidentType[] = [
  { key: "accident", label: "Accident", icon: "alert-circle", color: Colors.danger },
  { key: "reckless", label: "Reckless Driver", icon: "alert-octagon", color: Colors.danger },
  { key: "hazard", label: "Road Hazard", icon: "alert-triangle", color: Colors.warning },
  { key: "jam", label: "Traffic Jam", icon: "bar-chart-2", color: Colors.info },
  { key: "police", label: "Police Checkpoint", icon: "shield", color: Colors.info },
  { key: "broken_light", label: "Broken Traffic Light", icon: "zap-off", color: Colors.warning },
  { key: "flood", label: "Flooding", icon: "droplet", color: Colors.info },
  { key: "pothole", label: "Potholes", icon: "layers", color: Colors.warning },
];

interface Props {
  type: IncidentType;
  selected: boolean;
  onPress: () => void;
}

export default function IncidentCard({ type, selected, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, selected && { borderColor: type.color, backgroundColor: type.color + "18" }]}
    >
      <View style={[styles.icon, { backgroundColor: type.color + "22" }]}>
        <Feather name={type.icon as any} size={22} color={type.color} />
      </View>
      <Text style={styles.label}>{type.label}</Text>
      {selected && (
        <View style={[styles.check, { backgroundColor: type.color }]}>
          <Feather name="check" size={12} color="#fff" />
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 10,
    width: "47%",
    borderWidth: 1.5,
    borderColor: Colors.border,
    gap: 8,
    position: "relative",
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: "Inter_500Medium",
    fontSize: 12,
    color: Colors.text,
    textAlign: "center",
  },
  check: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
