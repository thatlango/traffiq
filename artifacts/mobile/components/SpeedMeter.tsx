import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

interface Props {
  speed: number;
  limit: number;
  size?: number;
}

export default function SpeedMeter({ speed, limit, size = 180 }: Props) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const isOver = speed > limit;

  useEffect(() => {
    if (isOver) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.06, duration: 500, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isOver]);

  const color = isOver ? Colors.danger : speed > limit * 0.8 ? Colors.warning : Colors.success;

  return (
    <Animated.View style={[styles.container, { width: size, height: size, borderRadius: size / 2, transform: [{ scale: pulseAnim }] }]}>
      <View style={[styles.outer, { width: size, height: size, borderRadius: size / 2, borderColor: color }]}>
        <View style={[styles.inner, { backgroundColor: Colors.card }]}>
          <Text style={[styles.speedText, { color, fontSize: size * 0.34 }]}>
            {Math.round(speed)}
          </Text>
          <Text style={[styles.unit, { color: Colors.textSecondary }]}>km/h</Text>
          <View style={[styles.limitBadge, { borderColor: color }]}>
            <Text style={[styles.limitText, { color }]}>LIMIT {limit}</Text>
          </View>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  outer: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 4,
  },
  inner: {
    width: "88%",
    height: "88%",
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  speedText: {
    fontFamily: "Inter_700Bold",
    lineHeight: undefined,
  },
  unit: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
  },
  limitBadge: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  limitText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 1,
  },
});
