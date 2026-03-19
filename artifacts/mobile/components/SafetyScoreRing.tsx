import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Circle, Defs, LinearGradient as SvgGradient, Stop } from "react-native-svg";
import Colors from "@/constants/colors";

interface Props {
  score: number;
  size?: number;
  showLabel?: boolean;
}

function polarToXY(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const sweep = endDeg - startDeg;
  if (Math.abs(sweep) < 0.5) return "";
  const s = polarToXY(cx, cy, r, startDeg);
  const e = polarToXY(cx, cy, r, endDeg);
  const large = sweep > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

const GAUGE_START = -120;
const GAUGE_END = 120;
const GAUGE_TOTAL = GAUGE_END - GAUGE_START;

function scoreColor(s: number): string {
  if (s >= 90) return Colors.scoreExcellent;
  if (s >= 70) return Colors.scoreGood;
  if (s >= 50) return Colors.scoreMedium;
  return Colors.scoreBad;
}

function scoreLabel(s: number): string {
  if (s >= 90) return "Excellent";
  if (s >= 70) return "Safe";
  if (s >= 50) return "Moderate";
  return "High Risk";
}

export default function SafetyScoreRing({ score, size = 120, showLabel = true }: Props) {
  const animScore = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(animScore, {
      toValue: score,
      tension: 40,
      friction: 8,
      useNativeDriver: false,
    }).start();
  }, [score]);

  const cx = size / 2;
  const cy = size / 2;
  const sw = size * 0.085;
  const r = (size - sw) / 2 - 2;

  const color = scoreColor(score);
  const label = scoreLabel(score);
  const progress = Math.min(score / 100, 1);
  const endDeg = GAUGE_START + progress * GAUGE_TOTAL;

  const trackPath = arcPath(cx, cy, r, GAUGE_START, GAUGE_END);
  const fillPath = arcPath(cx, cy, r, GAUGE_START, Math.max(GAUGE_START + 0.5, endDeg));

  const tipPoint = progress > 0.01 ? polarToXY(cx, cy, r, endDeg) : null;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <SvgGradient id="glowRing" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.12" />
            <Stop offset="1" stopColor={color} stopOpacity="0.03" />
          </SvgGradient>
        </Defs>

        {/* Outer glow halo */}
        <Circle
          cx={cx} cy={cy}
          r={r + sw * 0.7}
          stroke={color}
          strokeWidth={sw * 1.4}
          fill="none"
          opacity={0.08}
        />

        {/* Track */}
        <Path
          d={trackPath}
          stroke="rgba(255,255,255,0.07)"
          strokeWidth={sw}
          strokeLinecap="round"
          fill="none"
        />

        {/* Progress arc */}
        {fillPath ? (
          <Path
            d={fillPath}
            stroke={color}
            strokeWidth={sw}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}

        {/* Tip dot */}
        {tipPoint && (
          <Circle
            cx={tipPoint.x} cy={tipPoint.y}
            r={sw * 0.55}
            fill={color}
          />
        )}
      </Svg>

      {/* Center readout */}
      <View style={styles.center}>
        <Text style={[styles.score, { fontSize: size * 0.28, color }]}>{score}</Text>
        {showLabel && (
          <Text style={[styles.label, { fontSize: size * 0.105, color }]}>{label}</Text>
        )}
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
  center: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  score: {
    fontFamily: "Inter_700Bold",
    letterSpacing: -1,
  },
  label: {
    fontFamily: "Inter_600SemiBold",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
});
