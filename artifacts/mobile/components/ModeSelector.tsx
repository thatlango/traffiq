import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { TransportMode } from "@/context/JourneyContext";
import Colors from "@/constants/colors";
import * as Haptics from "expo-haptics";

interface Props {
  selected: TransportMode;
  onSelect: (mode: TransportMode) => void;
}

const MODES: { key: TransportMode; label: string; icon: string; lib: "feather" | "mci"; limit: number }[] = [
  { key: "car", label: "Car", icon: "car", lib: "mci", limit: 50 },
  { key: "taxi", label: "Taxi", icon: "taxi", lib: "mci", limit: 50 },
  { key: "bus", label: "Bus", icon: "bus", lib: "mci", limit: 60 },
  { key: "truck", label: "Truck", icon: "truck", lib: "feather", limit: 55 },
  { key: "boda", label: "Boda", icon: "motorbike", lib: "mci", limit: 45 },
  { key: "bicycle", label: "Bicycle", icon: "bicycle", lib: "mci", limit: 30 },
  { key: "walking", label: "Walk", icon: "walk", lib: "mci", limit: 10 },
];

export default function ModeSelector({ selected, onSelect }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scroll}>
      {MODES.map((mode) => {
        const isSelected = selected === mode.key;
        return (
          <Pressable
            key={mode.key}
            onPress={() => {
              Haptics.selectionAsync();
              onSelect(mode.key);
            }}
            style={[styles.item, isSelected && styles.itemSelected]}
          >
            {mode.lib === "mci" ? (
              <MaterialCommunityIcons
                name={mode.icon as any}
                size={24}
                color={isSelected ? Colors.primary : Colors.textSecondary}
              />
            ) : (
              <Feather
                name={mode.icon as any}
                size={22}
                color={isSelected ? Colors.primary : Colors.textSecondary}
              />
            )}
            <Text style={[styles.label, isSelected && styles.labelSelected]}>{mode.label}</Text>
            <Text style={[styles.limit, isSelected && styles.limitSelected]}>{mode.limit} km/h</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    gap: 10,
  },
  item: {
    alignItems: "center",
    backgroundColor: Colors.card,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 4,
    minWidth: 72,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  itemSelected: {
    backgroundColor: Colors.accent,
    borderColor: Colors.accent,
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    fontSize: 12,
    color: Colors.textSecondary,
  },
  labelSelected: {
    color: Colors.primary,
  },
  limit: {
    fontFamily: "Inter_400Regular",
    fontSize: 10,
    color: Colors.textMuted,
  },
  limitSelected: {
    color: Colors.primaryLight,
  },
});
