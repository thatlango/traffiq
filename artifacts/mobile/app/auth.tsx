import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useAuth } from "@/context/AuthContext";
import Colors from "@/constants/colors";

const { width, height } = Dimensions.get("window");

const FEATURES = [
  { icon: "navigation" as const, label: "GPS Tracking",    color: Colors.accent },
  { icon: "shield"     as const, label: "Safety Score",    color: Colors.success },
  { icon: "alert-triangle" as const, label: "Incident Alerts", color: Colors.warning },
  { icon: "share-2"    as const, label: "Journey Share",   color: Colors.info },
];

export default function AuthScreen() {
  const { signInWithGoogle, continueAsGuest } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);

  // Ambient glow animations
  const glow1 = useRef(new Animated.Value(0.4)).current;
  const glow2 = useRef(new Animated.Value(0.2)).current;
  const logoScale = useRef(new Animated.Value(0.8)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const pillAnims = FEATURES.map(() => useRef(new Animated.Value(0)).current);

  useEffect(() => {
    // Pulsing ambient orbs
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow1, { toValue: 0.7, duration: 3200, useNativeDriver: true }),
        Animated.timing(glow1, { toValue: 0.4, duration: 3200, useNativeDriver: true }),
      ])
    ).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(glow2, { toValue: 0.5, duration: 2600, useNativeDriver: true }),
        Animated.timing(glow2, { toValue: 0.15, duration: 2600, useNativeDriver: true }),
      ])
    ).start();

    // Logo entrance
    Animated.parallel([
      Animated.spring(logoScale, { toValue: 1, tension: 60, friction: 9, useNativeDriver: true }),
      Animated.timing(logoOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start();

    // Sheet fade in
    Animated.timing(contentOpacity, { toValue: 1, duration: 600, delay: 200, useNativeDriver: true }).start();

    // Staggered pill entrance
    pillAnims.forEach((anim, i) => {
      Animated.timing(anim, {
        toValue: 1, duration: 350, delay: 300 + i * 80, useNativeDriver: true,
      }).start();
    });
  }, []);

  const handleGoogle = async () => {
    setLoading(true);
    await signInWithGoogle();
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      {/* Deep gradient background */}
      <LinearGradient
        colors={["#050D1A", "#0A1628", "#0D1E35"]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0.3, y: 0 }}
        end={{ x: 0.7, y: 1 }}
      />

      {/* Grid lines */}
      <View style={styles.grid} pointerEvents="none">
        {Array.from({ length: 12 }).map((_, i) => (
          <View key={i} style={[styles.gridLine, { top: (i / 12) * height }]} />
        ))}
        {Array.from({ length: 8 }).map((_, i) => (
          <View key={`v${i}`} style={[styles.gridLineV, { left: (i / 8) * width }]} />
        ))}
      </View>

      {/* Ambient amber orb — top */}
      <Animated.View
        pointerEvents="none"
        style={[styles.orb, styles.orbAmber, { opacity: glow1 }]}
      />

      {/* Ambient blue orb — bottom-right */}
      <Animated.View
        pointerEvents="none"
        style={[styles.orb, styles.orbBlue, { opacity: glow2 }]}
      />

      {/* ── Logo area ── */}
      <View style={[styles.top, { paddingTop: insets.top + 48 }]}>
        <Animated.View style={{
          transform: [{ scale: logoScale }],
          opacity: logoOpacity,
          alignItems: "center",
          gap: 0,
        }}>
          {/* Double ring logo */}
          <View style={styles.logoOuter}>
            <View style={styles.logoMiddle}>
              <View style={styles.logoInner}>
                <MaterialCommunityIcons name="road-variant" size={38} color={Colors.accent} />
              </View>
            </View>
          </View>

          <Text style={styles.appName}>TraffIQ</Text>
          <Text style={styles.tagline}>Uganda's Road Safety Intelligence</Text>
        </Animated.View>

        {/* Feature pills — staggered entrance */}
        <View style={styles.featureRow}>
          {FEATURES.map((f, i) => (
            <Animated.View
              key={f.label}
              style={[
                styles.featurePill,
                {
                  opacity: pillAnims[i],
                  transform: [{ translateY: pillAnims[i].interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
                  borderColor: f.color + "33",
                },
              ]}
            >
              <Feather name={f.icon} size={13} color={f.color} />
              <Text style={[styles.featurePillText, { color: f.color }]}>{f.label}</Text>
            </Animated.View>
          ))}
        </View>
      </View>

      {/* ── Bottom sheet ── */}
      <Animated.View style={[styles.sheet, { opacity: contentOpacity, paddingBottom: insets.bottom + 24 }]}>
        {/* Glass top border */}
        <View style={styles.sheetHandle} />

        <View style={styles.sheetInner}>
          <View style={styles.sheetTextBlock}>
            <Text style={styles.sheetTitle}>Drive Smarter,{"\n"}Safer.</Text>
            <Text style={styles.sheetSub}>
              Real-time intelligence, safety scoring, and community incident alerts — built for Uganda's roads.
            </Text>
          </View>

          {/* Google button — premium gradient */}
          <Pressable
            onPress={handleGoogle}
            disabled={loading}
            style={({ pressed }) => [styles.googleBtnWrap, pressed && { opacity: 0.88, transform: [{ scale: 0.98 }] }]}
          >
            <LinearGradient
              colors={[Colors.accentLight, Colors.accent, Colors.accentDark]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.googleBtn}
            >
              {loading ? (
                <ActivityIndicator color={Colors.primary} size="small" />
              ) : (
                <>
                  <MaterialCommunityIcons name="google" size={22} color={Colors.primary} />
                  <Text style={styles.googleBtnText}>Continue with Google</Text>
                </>
              )}
            </LinearGradient>
          </Pressable>

          {/* Guest button */}
          <Pressable
            onPress={() => continueAsGuest("TraffIQ User")}
            style={({ pressed }) => [styles.guestBtn, pressed && { opacity: 0.65 }]}
          >
            <Text style={styles.guestBtnText}>Continue without account</Text>
          </Pressable>

          <View style={styles.termsRow}>
            <Feather name="lock" size={11} color={Colors.textMuted} />
            <Text style={styles.terms}>
              By continuing you agree to our Terms & Privacy Policy
            </Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#050D1A", justifyContent: "space-between" },

  // Background decorations
  grid: { position: "absolute", inset: 0 },
  gridLine: {
    position: "absolute", left: 0, right: 0,
    height: 1, backgroundColor: "rgba(255,255,255,0.028)",
  },
  gridLineV: {
    position: "absolute", top: 0, bottom: 0,
    width: 1, backgroundColor: "rgba(255,255,255,0.018)",
  },
  orb: { position: "absolute", borderRadius: 999 },
  orbAmber: {
    width: width * 0.9,
    height: width * 0.9,
    top: -width * 0.25,
    left: -width * 0.2,
    backgroundColor: Colors.accent,
    transform: [{ scaleY: 0.5 }],
  },
  orbBlue: {
    width: width * 0.7,
    height: width * 0.7,
    bottom: -width * 0.15,
    right: -width * 0.25,
    backgroundColor: Colors.info,
    transform: [{ scaleY: 0.45 }],
  },

  // Top hero
  top: { flex: 1, alignItems: "center", paddingHorizontal: 24, gap: 28 },
  logoOuter: {
    width: 112, height: 112, borderRadius: 56,
    borderWidth: 1, borderColor: Colors.accent + "25",
    backgroundColor: Colors.accent + "08",
    alignItems: "center", justifyContent: "center",
    marginBottom: 6,
  },
  logoMiddle: {
    width: 90, height: 90, borderRadius: 45,
    borderWidth: 1.5, borderColor: Colors.accent + "40",
    backgroundColor: Colors.accent + "12",
    alignItems: "center", justifyContent: "center",
  },
  logoInner: {
    width: 70, height: 70, borderRadius: 35,
    backgroundColor: Colors.accent + "22",
    borderWidth: 2, borderColor: Colors.accent + "66",
    alignItems: "center", justifyContent: "center",
  },
  appName: {
    fontFamily: "Inter_700Bold",
    fontSize: 52,
    color: Colors.text,
    letterSpacing: -2.5,
    marginTop: -4,
  },
  tagline: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: "center",
    letterSpacing: 0.2,
  },
  featureRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
  },
  featurePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    backdropFilter: "blur(8px)" as any,
  },
  featurePillText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },

  // Bottom sheet
  sheet: {
    backgroundColor: "rgba(15,30,55,0.97)",
    borderTopLeftRadius: 36,
    borderTopRightRadius: 36,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    overflow: "hidden",
  },
  sheetHandle: {
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignSelf: "center",
    marginTop: 14, marginBottom: 0,
  },
  sheetInner: {
    paddingHorizontal: 24,
    paddingTop: 22,
    gap: 14,
  },
  sheetTextBlock: { gap: 8 },
  sheetTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 28,
    color: Colors.text,
    letterSpacing: -0.8,
    lineHeight: 34,
  },
  sheetSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
  },
  googleBtnWrap: {
    borderRadius: 22,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 18,
    elevation: 10,
    marginTop: 6,
  },
  googleBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 18,
    borderRadius: 22,
  },
  googleBtnText: { fontFamily: "Inter_700Bold", fontSize: 17, color: Colors.primary },
  guestBtn: {
    paddingVertical: 15,
    alignItems: "center",
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  guestBtnText: { fontFamily: "Inter_500Medium", fontSize: 15, color: Colors.textSecondary },
  termsRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  terms: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 17,
  },
});
