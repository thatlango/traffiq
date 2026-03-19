import React, { useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  Image,
  KeyboardAvoidingView,
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
  { icon: "navigation", label: "Live GPS Tracking", desc: "Real-time journey monitoring across Uganda" },
  { icon: "shield", label: "Safety Scoring", desc: "Personal driving score with detailed breakdowns" },
  { icon: "alert-triangle", label: "Incident Reports", desc: "Crowdsourced road hazards from the community" },
  { icon: "share-2", label: "Journey Sharing", desc: "Share live location with next of kin" },
];

export default function AuthScreen() {
  const { signInWithGoogle, continueAsGuest } = useAuth();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"welcome" | "features">("welcome");

  const handleGoogle = async () => {
    setLoading(true);
    await signInWithGoogle();
    setLoading(false);
  };

  const handleGuest = () => {
    continueAsGuest("TraffIQ User");
  };

  if (step === "features") {
    return (
      <View style={[styles.container, { paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.featHeader}>
          <Pressable onPress={() => setStep("welcome")} style={styles.backBtn}>
            <Feather name="arrow-left" size={20} color={Colors.textSecondary} />
          </Pressable>
          <Text style={styles.featTitle}>What TraffIQ offers</Text>
        </View>

        <View style={styles.featuresList}>
          {FEATURES.map((f, i) => (
            <View key={f.icon} style={[styles.featureRow, { opacity: 1 }]}>
              <View style={[styles.featureIconBox, { backgroundColor: Colors.accent + "22" }]}>
                <Feather name={f.icon as any} size={22} color={Colors.accent} />
              </View>
              <View style={styles.featureText}>
                <Text style={styles.featureLabel}>{f.label}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.actions}>
          <Pressable onPress={handleGoogle} disabled={loading} style={styles.googleBtn}>
            {loading ? (
              <ActivityIndicator color={Colors.primary} size="small" />
            ) : (
              <>
                <MaterialCommunityIcons name="google" size={22} color={Colors.primary} />
                <Text style={styles.googleBtnText}>Continue with Google</Text>
              </>
            )}
          </Pressable>
          <Pressable onPress={handleGuest} style={styles.guestBtn}>
            <Text style={styles.guestBtnText}>Continue as Guest</Text>
          </Pressable>
          <Text style={styles.termsText}>
            By continuing you agree to our Terms of Service and Privacy Policy
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Hero gradient */}
      <View style={styles.heroSection}>
        <LinearGradient
          colors={["#0A1628", "#0F2040", "#152238"]}
          style={StyleSheet.absoluteFill}
        />
        {/* Grid overlay */}
        <View style={styles.gridOverlay} pointerEvents="none">
          {Array.from({ length: 8 }).map((_, i) => (
            <View key={i} style={[styles.gridLine, { top: i * (height * 0.35 / 8) }]} />
          ))}
        </View>

        {/* Logo */}
        <View style={[styles.heroContent, { paddingTop: insets.top + 48 }]}>
          <View style={styles.logoWrapper}>
            <View style={styles.logoRing}>
              <MaterialCommunityIcons name="road-variant" size={44} color={Colors.accent} />
            </View>
          </View>
          <Text style={styles.appName}>TraffIQ</Text>
          <Text style={styles.tagline}>Uganda's Road Safety Intelligence</Text>

          {/* Animated stats pills */}
          <View style={styles.statsPills}>
            <View style={styles.pill}>
              <View style={[styles.pillDot, { backgroundColor: Colors.success }]} />
              <Text style={styles.pillText}>Live in 50+ cities</Text>
            </View>
            <View style={styles.pill}>
              <View style={[styles.pillDot, { backgroundColor: Colors.accent }]} />
              <Text style={styles.pillText}>10k+ drivers</Text>
            </View>
          </View>
        </View>
      </View>

      {/* Bottom sheet */}
      <View style={[styles.bottomSheet, { paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.sheetHandle} />
        <Text style={styles.sheetTitle}>Drive Smarter, Safer</Text>
        <Text style={styles.sheetSubtitle}>
          Real-time traffic intelligence, safety scoring, and community incident alerts — built for Uganda's roads.
        </Text>

        <Pressable onPress={handleGoogle} disabled={loading} style={styles.googleBtn}>
          {loading ? (
            <ActivityIndicator color={Colors.primary} size="small" />
          ) : (
            <>
              <MaterialCommunityIcons name="google" size={22} color={Colors.primary} />
              <Text style={styles.googleBtnText}>Continue with Google</Text>
            </>
          )}
        </Pressable>

        <Pressable onPress={handleGuest} style={styles.guestBtn}>
          <Text style={styles.guestBtnText}>Continue without account</Text>
        </Pressable>

        <Pressable onPress={() => setStep("features")} style={styles.learnMore}>
          <Text style={styles.learnMoreText}>What does TraffIQ do?</Text>
          <Feather name="chevron-right" size={14} color={Colors.accent} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.primary },
  heroSection: { flex: 1, position: "relative", minHeight: height * 0.52 },
  gridOverlay: { position: "absolute", inset: 0 },
  gridLine: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  heroContent: { alignItems: "center", paddingHorizontal: 24, gap: 14 },
  logoWrapper: { marginBottom: 8 },
  logoRing: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.accent + "18",
    borderWidth: 2,
    borderColor: Colors.accent + "44",
    alignItems: "center",
    justifyContent: "center",
  },
  appName: {
    fontFamily: "Inter_700Bold",
    fontSize: 44,
    color: Colors.text,
    letterSpacing: -1.5,
  },
  tagline: {
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    color: Colors.textSecondary,
    textAlign: "center",
    letterSpacing: 0.3,
  },
  statsPills: { flexDirection: "row", gap: 12, marginTop: 8 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: Colors.card,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  pillDot: { width: 7, height: 7, borderRadius: 3.5 },
  pillText: { fontFamily: "Inter_500Medium", fontSize: 12, color: Colors.textSecondary },
  bottomSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 16,
    borderTopWidth: 1,
    borderColor: Colors.border,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: "center",
    marginBottom: 8,
  },
  sheetTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 26,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  sheetSubtitle: {
    fontFamily: "Inter_400Regular",
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 22,
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
  },
  googleBtnText: {
    fontFamily: "Inter_700Bold",
    fontSize: 17,
    color: Colors.primary,
  },
  guestBtn: {
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  guestBtnText: {
    fontFamily: "Inter_500Medium",
    fontSize: 15,
    color: Colors.textSecondary,
  },
  learnMore: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 4,
  },
  learnMoreText: {
    fontFamily: "Inter_500Medium",
    fontSize: 13,
    color: Colors.accent,
  },
  termsText: {
    fontFamily: "Inter_400Regular",
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: "center",
    lineHeight: 18,
  },
  // Features step
  featHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.card,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.border,
  },
  featTitle: {
    fontFamily: "Inter_700Bold",
    fontSize: 20,
    color: Colors.text,
  },
  featuresList: { flex: 1, paddingHorizontal: 20, gap: 16 },
  featureRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    backgroundColor: Colors.card,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  featureIconBox: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  featureText: { flex: 1 },
  featureLabel: { fontFamily: "Inter_600SemiBold", fontSize: 15, color: Colors.text },
  featureDesc: { fontFamily: "Inter_400Regular", fontSize: 12, color: Colors.textSecondary, marginTop: 3 },
  actions: { gap: 12, paddingHorizontal: 20 },
});
