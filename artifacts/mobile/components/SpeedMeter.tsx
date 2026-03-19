import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import Svg, { Path, Circle } from "react-native-svg";
import Colors from "@/constants/colors";

interface Props {
  speed: number;
  limit: number;
  size?: number;
}

// Convert polar angle (degrees from north, clockwise) → SVG cartesian
function polarToXY(cx: number, cy: number, r: number, deg: number) {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

// Build an SVG arc path
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const sweep = endDeg - startDeg;
  if (Math.abs(sweep) < 0.5) return "";
  const s = polarToXY(cx, cy, r, startDeg);
  const e = polarToXY(cx, cy, r, endDeg);
  const large = sweep > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

// Speed-to-color: smooth 5-stop gradient
function speedColor(speed: number, limit: number): string {
  const ratio = speed / limit;
  if (ratio <= 0) return "#10B981";          // green  (stopped)
  if (ratio < 0.5) return "#10B981";         // green  (0–50%)
  if (ratio < 0.75) return "#84CC16";        // lime   (50–75%)
  if (ratio < 0.9) return "#F59E0B";         // amber  (75–90%)
  if (ratio < 1.0) return "#F97316";         // orange (90–100%)
  return "#EF4444";                          // red    (over limit)
}

// Speed-to-glow: matching shadow colors
function glowColor(speed: number, limit: number): string {
  const ratio = speed / limit;
  if (ratio < 0.75) return "#10B98155";
  if (ratio < 0.9) return "#F59E0B55";
  if (ratio < 1.0) return "#F9731655";
  return "#EF444455";
}

const GAUGE_START = -135;  // 7:30 position
const GAUGE_END = 135;     // 4:30 position
const GAUGE_TOTAL = GAUGE_END - GAUGE_START; // 270°

export default function SpeedMeter({ speed, limit, size = 200 }: Props) {
  const isOver = speed > limit;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0)).current;

  // Max speed displayed = 150% of limit
  const maxDisplaySpeed = limit * 1.5;
  const clampedSpeed = Math.min(speed, maxDisplaySpeed);
  const targetProgress = clampedSpeed / maxDisplaySpeed; // 0-1

  useEffect(() => {
    Animated.spring(progressAnim, {
      toValue: targetProgress,
      tension: 60,
      friction: 10,
      useNativeDriver: false,
    }).start();
  }, [targetProgress]);

  useEffect(() => {
    if (isOver) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.05, duration: 450, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 450, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      Animated.spring(pulseAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 8 }).start();
    }
  }, [isOver]);

  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = size * 0.07;
  const r = (size - strokeWidth) / 2 - 4;

  const color = speedColor(speed, limit);
  const glow = glowColor(speed, limit);

  // Full background track
  const trackPath = arcPath(cx, cy, r, GAUGE_START, GAUGE_END);

  // Progress arc computed per render (not via SVG animation - simpler & reliable)
  const progressDeg = GAUGE_START + targetProgress * GAUGE_TOTAL;
  const progressPath = arcPath(cx, cy, r, GAUGE_START, Math.max(GAUGE_START + 0.5, progressDeg));

  // Speed zone markers (25%, 50%, 75%, 100% of limit)
  const zoneAngles = [0.33, 0.50, 0.67, 1.0 / 1.5].map(f => GAUGE_START + (f / 1.5) * GAUGE_TOTAL);

  return (
    <Animated.View style={[styles.container, { width: size, height: size, transform: [{ scale: pulseAnim }] }]}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        {/* Glow ring (outer) */}
        <Circle cx={cx} cy={cy} r={r + strokeWidth * 0.5} stroke={glow} strokeWidth={strokeWidth * 2} fill="none" />

        {/* Background track */}
        <Path
          d={trackPath}
          stroke={Colors.border}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="none"
        />

        {/* Zone ticks */}
        {zoneAngles.map((angle, i) => {
          const inner = polarToXY(cx, cy, r - strokeWidth * 0.6, angle);
          const outer = polarToXY(cx, cy, r + strokeWidth * 0.6, angle);
          return (
            <Path
              key={i}
              d={`M ${inner.x.toFixed(2)} ${inner.y.toFixed(2)} L ${outer.x.toFixed(2)} ${outer.y.toFixed(2)}`}
              stroke="rgba(255,255,255,0.15)"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
          );
        })}

        {/* Progress arc */}
        {progressPath ? (
          <Path
            d={progressPath}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            fill="none"
          />
        ) : null}

        {/* Needle tip dot */}
        {targetProgress > 0.01 && (() => {
          const tip = polarToXY(cx, cy, r, Math.max(GAUGE_START + 0.5, progressDeg));
          return (
            <Circle
              cx={tip.x}
              cy={tip.y}
              r={strokeWidth * 0.55}
              fill={color}
            />
          );
        })()}
      </Svg>

      {/* Center readout */}
      <View style={styles.center} pointerEvents="none">
        <Text style={[styles.speedNum, { color, fontSize: size * 0.28 }]}>
          {Math.round(speed)}
        </Text>
        <Text style={styles.unit}>km/h</Text>
        <View style={[styles.limitBadge, { borderColor: color + "88", backgroundColor: color + "18" }]}>
          <Text style={[styles.limitText, { color }]}>LIMIT {limit}</Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  center: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  speedNum: {
    fontFamily: "Inter_700Bold",
    letterSpacing: -2,
  },
  unit: {
    fontFamily: "Inter_500Medium",
    fontSize: 14,
    color: Colors.textSecondary,
  },
  limitBadge: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  limitText: {
    fontFamily: "Inter_700Bold",
    fontSize: 10,
    letterSpacing: 1.2,
  },
});
