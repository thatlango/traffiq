import { useState } from "react";
import { GoogleLogin, CredentialResponse } from "@react-oauth/google";
import { Map, ShieldCheck, AlertCircle } from "lucide-react";

const ADMIN_EMAIL = "odurjacob2@gmail.com";

function parseJwt(token: string) {
  try {
    const base64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

interface Props {
  onAuth: (email: string, name: string, picture?: string) => void;
}

export default function AdminLogin({ onAuth }: Props) {
  const [error, setError] = useState<string | null>(null);
  const hasClientId = Boolean(import.meta.env.VITE_GOOGLE_CLIENT_ID);

  const handleSuccess = (res: CredentialResponse) => {
    setError(null);
    if (!res.credential) { setError("No credential returned."); return; }
    const payload = parseJwt(res.credential);
    if (!payload) { setError("Invalid token."); return; }
    if (payload.email !== ADMIN_EMAIL) {
      setError(`Access denied for ${payload.email}. Only the TraffIQ admin can access this dashboard.`);
      return;
    }
    onAuth(payload.email, payload.name ?? "Admin", payload.picture);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-8 text-center">
        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-primary/20 border border-primary/30 flex items-center justify-center">
            <Map size={32} className="text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">TraffIQ</h1>
            <p className="text-muted-foreground mt-1">Admin Dashboard</p>
          </div>
        </div>

        {/* Card */}
        <div className="bg-card border border-card-border rounded-2xl p-8 space-y-6">
          <div className="flex flex-col items-center gap-2">
            <ShieldCheck size={24} className="text-primary" />
            <h2 className="text-lg font-semibold text-foreground">Admin Access Only</h2>
            <p className="text-sm text-muted-foreground">
              Sign in with the TraffIQ admin Google account to continue.
            </p>
          </div>

          {error && (
            <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 text-left">
              <AlertCircle size={16} className="text-destructive flex-shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {hasClientId ? (
            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={handleSuccess}
                onError={() => setError("Google Sign-In failed. Try again.")}
                theme="filled_black"
                shape="pill"
                text="signin_with"
                size="large"
              />
            </div>
          ) : (
            <div className="bg-muted/50 border border-border rounded-xl px-4 py-4 text-sm text-muted-foreground space-y-2">
              <p className="font-medium text-foreground">Google Client ID not configured</p>
              <p>Set <code className="text-primary bg-primary/10 px-1.5 py-0.5 rounded text-xs">VITE_GOOGLE_CLIENT_ID</code> in environment secrets to enable sign-in.</p>
            </div>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          TraffIQ · Uganda Road Safety Intelligence · traffiq.tukutuku.org
        </p>
      </div>
    </div>
  );
}
