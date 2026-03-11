import React, { useEffect, useRef } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { SafetyAlert } from "@/context/JourneyContext";
import Colors from "@/constants/colors";

interface Props {
  alert: SafetyAlert;
  onDismiss: () => void;
}

const ALERT_ICONS: Record<string, string> = {
  overspeed: "alert-octagon",
  harsh_braking: "activity",
  accident: "alert-circle",
  hazard: "alert-triangle",
  congestion: "bar-chart-2",
};

const ALERT_COLORS: Record<string, string> = {
  overspeed: Colors.danger,
  harsh_braking: Colors.warning,
  accident: Colors.danger,
  hazard: Colors.warning,
  congestion: Colors.info,
};

export default function AlertBanner({ alert, onDismiss }: Props) {
  const slideAnim = useRef(new Animated.Value(-80)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      dismiss();
    }, 6000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: -80, duration: 200, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss());
  };

  const color = ALERT_COLORS[alert.type] ?? Colors.warning;
  const icon = ALERT_ICONS[alert.type] ?? "alert-triangle";

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY: slideAnim }], opacity: opacityAnim }]}>
      <View style={[styles.card, { borderLeftColor: color }]}>
        <View style={[styles.iconWrapper, { backgroundColor: color + "22" }]}>
          <Feather name={icon as any} size={20} color={color} />
        </View>
        <Text style={styles.message} numberOfLines={2}>{alert.message}</Text>
        <Pressable onPress={dismiss} hitSlop={12}>
          <Feather name="x" size={18} color={Colors.textSecondary} />
        </Pressable>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingHorizontal: 16,
  },
  card: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    gap: 12,
    borderLeftWidth: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  message: {
    flex: 1,
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 14,
    lineHeight: 20,
  },
});
