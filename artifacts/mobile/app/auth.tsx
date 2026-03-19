import React, { useState } from "react";
import {
  ActivityIndicator,
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

const { height } = Dimensions.get("window");

const FEATURES = [
  { icon: "navigation" as const, label: "GPS Tracking", color: Colors.accent },
  { icon: "shield" as const, label: "Safety Score", color: Colors.success },
  { icon: "alert-triangle" as const, label: "Incident Alerts", color: Colors.warning },
  { icon: "share-2" as const, label: "Journey Share", color: Colors.info },
];

export default function AuthScreen() {
  const { signInWithGoogle, continueAsGuest } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);

  const handleGoogle = async () => {
    setLoading(true);
    await signInWithGoogle();
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      {/* Full-screen gradient */}
      <LinearGradient
        colors={["#0A1628", "#0F2040", "#0A1628"]}
        style={StyleSheet.absoluteFill}
      />

      {/* Subtle grid */}
      <View style={styles.grid} pointerEvents="none">
        {Array.from({ length: 10 }).map((_, i) => (
          <View key={i} style={[styles.gridLine, { top: (i / 10) * height }]} />
        ))}
      </View>

      {/* Top — logo area */}
      <View style={[styles.top, { paddingTop: insets.top + 56 }]}>
        <View style={styles.logoRing}>
          <MaterialCommunityIcons name="road-variant" size={44} color={Colors.accent} />
        </View>
        <Text style={styles.appName}>TraffIQ</Text>
        <Text style={styles.tagline}>Uganda's Road Safety Intelligence</Text>

        {/* Feature pills row */}
        <View style={styles.featureRow}>
          {FEATURES.map(f => (
            <View key={f.label} style={styles.featurePill}>
              <Feather name={f.icon} size={14} color={f.color} />
              <Text style={[styles.featurePillText, { color: f.color }]}>{f.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Bottom sheet */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.sheetHandle} />

        <Text style={styles.sheetTitle}>Drive Smarter, Safer</Text>
        <Text style={styles.sheetSub}>
          Real-time intelligence, safety scoring, and community incident alerts — built for Uganda's roads.
        </Text>

        {/* Google button */}
        <Pressable
          onPress={handleGoogle}
          disabled={loading}
          style={({ pressed }) => [styles.googleBtn, pressed && { opacity: 0.85 }]}
        >
          {loading ? (
            <ActivityIndicator color={Colors.primary} size="small" />
          ) : (
            <>
              <MaterialCommunityIcons name="google" size={22} color={Colors.primary} />
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        {/* Guest button */}
        <Pressable
          onPress={() => continueAsGuest("TraffIQ User")}
          style={({ pressed }) => [styles.guestBtn, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.guestBtnText}>Continue without account</Text>
        </Pressable>

        <Text style={styles.terms}>
          By continuing you agree to our Terms & Privacy Policy
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary, justifyContent: "space-between" },
  grid: { position: "absolute", inset: 0 },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.035)",
  },
  top: { flex: 1, alignItems: "center", paddingHorizontal: 24, gap: 12 },
  logoRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.accent + "18",
    borderWidth: 2,
    borderColor: Colors.accent + "40",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  appName: {
    fontFamily: "Inter_700Bold",
    fontSize: 48,
    color: Colors.text,
    letterSpacing: -2,
  },
  tagline: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
  },
  featureRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginTop: 16,
  },
  featurePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.card,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  featurePillText: { fontFamily: "Inter_600SemiBold", fontSize: 12 },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 14,
    borderTopWidth: 1,
    borderColor: Colors.border,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 6,
  },
  sheetTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 24,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  sheetSub: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 21,
  },
  googleBtn: {
    backgroundColor: Colors.accent,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 17,
    borderRadius: 20,
    shadowColor: Colors.accent,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 6,
    marginTop: 4,
  },
  googleBtnText: { fontFamily: "Inter_700Bold", fontSize: 17, color: Colors.primary },
  guestBtn: {
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  guestBtnText: { fontFamily: "Inter_500Medium", fontSize: 15, color: Colors.textSecondary },
  terms: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 17,
  },
});
