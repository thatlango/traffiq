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

const DISMISS_MS = 6000;

export default function AlertBanner({ alert, onDismiss }: Props) {
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.92)).current;
  const progressAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideAnim, { toValue: 0, tension: 100, friction: 12, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 1, tension: 100, friction: 12, useNativeDriver: true }),
    ]).start();

    // Progress bar drains over DISMISS_MS
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: DISMISS_MS,
      useNativeDriver: false,
    }).start();

    const timer = setTimeout(dismiss, DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, { toValue: -100, duration: 220, useNativeDriver: true }),
      Animated.timing(opacityAnim, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.spring(scaleAnim, { toValue: 0.9, tension: 100, friction: 10, useNativeDriver: true }),
    ]).start(() => onDismiss());
  };

  const color = ALERT_COLORS[alert.type] ?? Colors.warning;
  const icon = ALERT_ICONS[alert.type] ?? "alert-triangle";
  const progressWidth = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });

  return (
    <Animated.View style={[
      styles.container,
      {
        transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
        opacity: opacityAnim,
      },
    ]}>
      <View style={[styles.card, { borderColor: color + "30" }]}>
        {/* Left accent bar */}
        <View style={[styles.accentBar, { backgroundColor: color }]} />

        <View style={[styles.iconWrapper, { backgroundColor: color + "22" }]}>
          <Feather name={icon as any} size={20} color={color} />
        </View>

        <Text style={styles.message} numberOfLines={2}>{alert.message}</Text>

        <Pressable onPress={dismiss} hitSlop={14} style={styles.closeBtn}>
          <Feather name="x" size={16} color={Colors.textSecondary} />
        </Pressable>
      </View>

      {/* Progress drain bar */}
      <View style={styles.progressTrack}>
        <Animated.View
          style={[styles.progressFill, { width: progressWidth, backgroundColor: color }]}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 16,
    marginBottom: 4,
    borderRadius: 18,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 12,
  },
  card: {
    backgroundColor: "#1A2D4A",
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    paddingHorizontal: 14,
    paddingLeft: 8,
    gap: 12,
    borderWidth: 1,
    borderRadius: 18,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
  },
  accentBar: {
    width: 4,
    alignSelf: "stretch",
    borderRadius: 4,
  },
  iconWrapper: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  message: {
    flex: 1,
    color: Colors.text,
    fontFamily: "Inter_600SemiBold",
    fontSize: 13,
    lineHeight: 19,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.07)",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  progressTrack: {
    height: 3,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  progressFill: {
    height: "100%",
    borderRadius: 2,
  },
});
