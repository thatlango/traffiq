import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as WebBrowser from "expo-web-browser";
import * as Google from "expo-auth-session/providers/google";

WebBrowser.maybeCompleteAuthSession();

export interface AppUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  isGuest?: boolean;
}

interface AuthContextValue {
  user: AppUser | null;
  isLoading: boolean;
  signInWithGoogle: () => Promise<void>;
  continueAsGuest: (name?: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEY = "@traffiq_user";
const API_BASE = "/api";

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
const GOOGLE_ANDROID_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? "";

const HAS_GOOGLE_CREDENTIALS = Boolean(GOOGLE_WEB_CLIENT_ID);

// Separate component that uses the Google hook — only rendered when credentials exist
function GoogleAuthHandler({
  onResponse,
  promptRef,
}: {
  onResponse: (token: string) => void;
  promptRef: React.MutableRefObject<(() => Promise<void>) | null>;
}) {
  const [, response, promptAsync] = Google.useAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    androidClientId: GOOGLE_ANDROID_CLIENT_ID || undefined,
    expoClientId: GOOGLE_WEB_CLIENT_ID,
  });

  useEffect(() => {
    promptRef.current = async () => {
      await promptAsync();
    };
  }, [promptAsync]);

  useEffect(() => {
    if (response?.type === "success") {
      const token = response.authentication?.accessToken;
      if (token) onResponse(token);
    }
  }, [response]);

  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const googlePromptRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    loadStoredUser();
  }, []);

  useEffect(() => {
    if (user && !user.isGuest) {
      heartbeatRef.current = setInterval(() => pingHeartbeat(user.id), 60_000);
      pingHeartbeat(user.id);
    }
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [user]);

  const loadStoredUser = async () => {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) setUser(JSON.parse(stored));
    } catch {}
    setIsLoading(false);
  };

  const saveUser = async (u: AppUser) => {
    setUser(u);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(u));
  };

  const handleGoogleToken = useCallback(async (accessToken: string) => {
    try {
      const res = await fetch("https://www.googleapis.com/userinfo/v2/me", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      const appUser: AppUser = {
        id: data.id,
        email: data.email,
        name: data.name,
        avatarUrl: data.picture,
        isGuest: false,
      };
      await registerWithBackend(appUser);
      await saveUser(appUser);
    } catch {
      continueAsGuest("TraffIQ User");
    }
  }, []);

  const registerWithBackend = async (appUser: AppUser) => {
    try {
      await fetch(`${API_BASE}/auth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          googleId: appUser.id,
          email: appUser.email,
          name: appUser.name,
          avatarUrl: appUser.avatarUrl,
          platform: Platform.OS,
        }),
      });
    } catch {}
  };

  const pingHeartbeat = async (userId: string) => {
    try {
      await fetch(`${API_BASE}/users/${userId}/heartbeat`, { method: "PATCH" });
    } catch {}
  };

  const signInWithGoogle = useCallback(async () => {
    if (!HAS_GOOGLE_CREDENTIALS || !googlePromptRef.current) {
      // No Google credentials — use guest mode as fallback
      continueAsGuest("TraffIQ User");
      return;
    }
    await googlePromptRef.current();
  }, []);

  const continueAsGuest = useCallback((name = "Guest User") => {
    const guestUser: AppUser = {
      id: `guest_${Date.now()}`,
      email: `guest@traffiq.local`,
      name,
      isGuest: true,
    };
    saveUser(guestUser);
  }, []);

  const signOut = useCallback(async () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    setUser(null);
    await AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <AuthContext.Provider value={{ user, isLoading, signInWithGoogle, continueAsGuest, signOut }}>
      {HAS_GOOGLE_CREDENTIALS && (
        <GoogleAuthHandler onResponse={handleGoogleToken} promptRef={googlePromptRef} />
      )}
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
