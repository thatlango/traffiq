import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View, useColorScheme } from "react-native";
import Colors from "@/constants/colors";

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: "map", selected: "map.fill" }} />
        <Label>Map</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="journey">
        <Icon sf={{ default: "location", selected: "location.fill" }} />
        <Label>Journey</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="report">
        <Icon sf={{ default: "exclamationmark.triangle", selected: "exclamationmark.triangle.fill" }} />
        <Label>Report</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>Profile</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.tabIconDefault,
        headerShown: false,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: "transparent",
          borderTopWidth: 0,
          elevation: 0,
          ...(isWeb ? { height: 84 } : { height: 80 }),
        },
        tabBarLabelStyle: {
          fontFamily: "Inter_500Medium",
          fontSize: 11,
          letterSpacing: 0.2,
          marginBottom: isWeb ? 6 : 4,
        },
        tabBarItemStyle: {
          paddingTop: 8,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={90}
              tint="dark"
              style={StyleSheet.absoluteFill}
            />
          ) : (
            <View style={StyleSheet.absoluteFill}>
              {/* Background fill */}
              <View style={[StyleSheet.absoluteFill, styles.tabBarBg]} />
              {/* Top accent line */}
              <View style={styles.tabBarTopLine} />
            </View>
          ),
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Map",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="map.fill" tintColor={color} size={24} />
            ) : (
              <Feather name="map" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="journey"
        options={{
          title: "Journey",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="location.fill" tintColor={color} size={24} />
            ) : (
              <Feather name="navigation" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="report"
        options={{
          title: "Report",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="exclamationmark.triangle.fill" tintColor={color} size={24} />
            ) : (
              <Feather name="alert-triangle" size={22} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="person.fill" tintColor={color} size={24} />
            ) : (
              <Feather name="user" size={22} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}

const styles = StyleSheet.create({
  tabBarBg: {
    backgroundColor: "rgba(8,18,34,0.97)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
  },
  tabBarTopLine: {
    position: "absolute",
    top: 0, left: 40, right: 40,
    height: 1,
    backgroundColor: "rgba(245,158,11,0.18)",
    borderRadius: 1,
  },
});
