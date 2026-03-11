import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import Colors from "@/constants/colors";

interface Props {
  score: number;
  size?: number;
  showLabel?: boolean;
}

export default function SafetyScoreRing({ score, size = 120, showLabel = true }: Props) {
  const animatedScore = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(animatedScore, {
      toValue: score,
      duration: 1200,
      useNativeDriver: false,
    }).start();
  }, [score]);

  const getColor = (s: number) => {
    if (s >= 90) return Colors.scoreExcellent;
    if (s >= 70) return Colors.scoreGood;
    if (s >= 50) return Colors.scoreMedium;
    return Colors.scoreBad;
  };

  const getLabel = (s: number) => {
    if (s >= 90) return "Excellent";
    if (s >= 70) return "Safe";
    if (s >= 50) return "Moderate";
    return "High Risk";
  };

  const color = getColor(score);
  const strokeWidth = size * 0.09;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <View style={[styles.ring, { width: size, height: size, borderRadius: size / 2, borderColor: Colors.border, borderWidth: strokeWidth }]} />
      <View style={[styles.fill, { width: size, height: size, borderRadius: size / 2, borderColor: color, borderWidth: strokeWidth, borderRightColor: "transparent", borderBottomColor: score < 50 ? "transparent" : color, transform: [{ rotate: `${(score / 100) * 360 - 90}deg` }] }]} />
      <View style={styles.center}>
        <Text style={[styles.score, { fontSize: size * 0.28, color }]}>{score}</Text>
        {showLabel && <Text style={[styles.label, { fontSize: size * 0.11, color }]}>{getLabel(score)}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  ring: {
    position: "absolute",
    opacity: 0.15,
  },
  fill: {
    position: "absolute",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  score: {
    fontFamily: "Inter_700Bold",
    lineHeight: undefined,
  },
  label: {
    fontFamily: "Inter_500Medium",
    marginTop: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});
