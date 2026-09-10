import { Fragment, createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { queryClient, queryPersister } from "../lib/queryClient";

const AuthContext = createContext(null);
const AUTH_USER_STORAGE_KEY = "smartvisualnaudio.auth.user";
const SESSION_VALIDATION_INTERVAL_MS = 60_000;
const CURRENT_SESSION_LOGIN_KEY = "smartvisualnaudio.auth.current-session-login";

const demoUser = {
  id: "demo-admin",
  email: "admin@university.edu",
  role: "Admin",
  fullName: "Admin User",
  themeColor: "#2563EB",
  fontColor: "#FFFFFF",
  backgroundColor: "#000000",
  iconColor: "#FFFFFF",
};

const demoUsers = {
  "cluster@university.edu": {
    id: "demo-cluster",
    email: "cluster@university.edu",
    role: "Cluster Professor",
    fullName: "Prof. Nolan Lim",
    status: "Active",
    createdAt: "2026-05-01",
    themeColor: "#2563EB",
    fontColor: "#FFFFFF",
    backgroundColor: "#000000",
    iconColor: "#FFFFFF",
  },
  "professor@university.edu": {
    id: "demo-professor",
    email: "professor@university.edu",
    role: "Professor",
    fullName: "Dr. Maria Santos",
    status: "Active",
    createdAt: "2026-04-20",
    themeColor: "#2563EB",
    fontColor: "#FFFFFF",
    backgroundColor: "#000000",
    iconColor: "#FFFFFF",
  },
  "dean@university.edu": {
    id: "demo-dean",
    email: "dean@university.edu",
    role: "Dean",
    fullName: "Dean Angela Cruz",
    status: "Active",
    createdAt: "2026-04-18",
    themeColor: "#2563EB",
    fontColor: "#FFFFFF",
    backgroundColor: "#000000",
    iconColor: "#FFFFFF",
  },
  "student@university.edu": {
    id: "demo-student",
    email: "student@university.edu",
    role: "Student",
    fullName: "Ivan Caburnay",
    status: "Active",
    createdAt: "2026-05-31",
    themeColor: "#2563EB",
    fontColor: "#FFFFFF",
    backgroundColor: "#000000",
    iconColor: "#FFFFFF",
  },
};

const allowDemoAuth = !hasSupabaseConfig && import.meta.env.DEV;

function getCachedUser() {
  try {
    const cached = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
    if (!cached) return null;
    const parsed = JSON.parse(cached);
    return parsed?.id && parsed?.email ? parsed : null;
  } catch {
    return null;
  }
}

function cacheUser(nextUser) {
  try {
    if (nextUser) {
      window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(nextUser));
    } else {
      window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
    }
  } catch {
    // Ignore storage failures; Supabase still owns the real session.
  }
}

function hasCurrentSessionLogin() {
  try {
    return window.sessionStorage.getItem(CURRENT_SESSION_LOGIN_KEY) === "true";
  } catch {
    return false;
  }
}

function setCurrentSessionLogin(isLoggedIn) {
  try {
    if (isLoggedIn) {
      window.sessionStorage.setItem(CURRENT_SESSION_LOGIN_KEY, "true");
    } else {
      window.sessionStorage.removeItem(CURRENT_SESSION_LOGIN_KEY);
    }
  } catch {
    // If session storage is unavailable, require a fresh login on reload.
  }
}

function withTimeout(promise, ms = 6000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error("Request timed out.")), ms);
    }),
  ]);
}

async function mapAuthUser(authUser, previousUser = null) {
  if (!authUser) return null;

  let profile = null;
  let profileLoaded = !hasSupabaseConfig;
  if (hasSupabaseConfig) {
    try {
      const { data, error } = await withTimeout(
        supabase
          .from("profiles")
          .select("role, full_name, status, avatar_url")
          .eq("id", authUser.id)
          .maybeSingle(),
      );
      if (error) throw error;
      profile = data;
      profileLoaded = true;
    } catch (error) {
      window.console.error("[Auth] Profile load failed", error);
    }
  }

  const canReusePrevious = previousUser?.id === authUser.id;
  const metadata = authUser.user_metadata || {};

  return {
    id: authUser.id,
    email: authUser.email,
    role: profileLoaded
      ? (profile?.role || metadata.role || "Student")
      : (canReusePrevious ? previousUser.role : metadata.role || "Student"),
    fullName: profileLoaded
      ? (profile?.full_name || metadata.full_name || authUser.email)
      : (canReusePrevious ? previousUser.fullName : metadata.full_name || authUser.email),
    status: profileLoaded
      ? (profile?.status || metadata.status)
      : (canReusePrevious ? previousUser.status : metadata.status),
    avatarUrl: profileLoaded
      ? (profile ? profile.avatar_url || "" : metadata.avatar_url || "")
      : (canReusePrevious ? previousUser.avatarUrl : metadata.avatar_url || ""),
  };
}

export function AuthProvider({ children }) {
  const [hasLoggedInThisSession, setHasLoggedInThisSession] = useState(hasCurrentSessionLogin);
  const [user, setUser] = useState(() => {
    if (!hasCurrentSessionLogin()) return null;
    return getCachedUser() || (allowDemoAuth ? demoUser : null);
  });
  const userRef = useRef(user);
  const intentionalLogout = useRef(false);
  const [loading, setLoading] = useState(() => Boolean(hasSupabaseConfig && hasCurrentSessionLogin()));

  useEffect(() => {
    userRef.current = user;
  }, [user]);

  useEffect(() => {
    if (!hasSupabaseConfig) {
      setLoading(false);
      return undefined;
    }

    let active = true;
    let generation = 0;
    function expireSession() {
      generation += 1;
      if (!active) return;
      if (hasCurrentSessionLogin() && !intentionalLogout.current) toast.error("Your session has expired. Please log in again.");
      setCurrentSessionLogin(false);
      setHasLoggedInThisSession(false);
      queryClient.clear();
      queryPersister.removeClient();
      userRef.current = null;
      setUser(null);
      cacheUser(null);
      setLoading(false);
    }

    async function loadSession() {
      if (!hasCurrentSessionLogin()) {
        setUser(null);
        cacheUser(null);
        setLoading(false);
        return;
      }

      try {
        const version = generation;
        const { data, error } = await withTimeout(supabase.auth.getSession());
        if (error || !data.session) { expireSession(); return; }
        const validation = await withTimeout(supabase.auth.getUser());
        if (validation.error || !validation.data.user) { expireSession(); return; }
        const authUser = validation.data.user;
        const nextUser = await mapAuthUser(authUser, userRef.current || getCachedUser());
        if (active && version === generation) {
          userRef.current = nextUser;
          setUser(nextUser);
          cacheUser(nextUser);
        }
      } catch (error) {
        window.console.error("[Auth] Session load failed", error);
        expireSession();
      } finally {
        if (active) setLoading(false);
      }
    }

    loadSession();
    const validationTimer = window.setInterval(async () => {
      if (!hasCurrentSessionLogin()) return;
      const { error } = await supabase.auth.getUser();
      if (error && (error.status === 401 || error.status === 403 || error.name === "AuthSessionMissingError")) expireSession();
    }, SESSION_VALIDATION_INTERVAL_MS);

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") { expireSession(); return; }
      if (!hasCurrentSessionLogin() || event === "INITIAL_SESSION") return;
      if (!session?.user) { expireSession(); return; }
      // Refresh events keep the validated profile and avoid duplicate profile requests.
      if (event === "TOKEN_REFRESHED" && session.user.id === userRef.current?.id) return;
      const version = generation;
      // Run outside the auth callback to avoid holding the Supabase auth lock.
      window.setTimeout(async () => {
        const nextUser = await mapAuthUser(session.user, userRef.current);
        if (!active || version !== generation || !hasCurrentSessionLogin()) return;
        userRef.current = nextUser;
        setUser(nextUser);
        cacheUser(nextUser);
      }, 0);
    });

    return () => {
      active = false;
      window.clearInterval(validationTimer);
      listener.subscription.unsubscribe();
    };
  }, []);

  async function login(email, password) {
    intentionalLogout.current = false;
    queryClient.clear();
    queryPersister.removeClient();
    if (hasSupabaseConfig) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const nextUser = await mapAuthUser(data.user);
      setCurrentSessionLogin(true);
      setHasLoggedInThisSession(true);
      setUser(nextUser);
      cacheUser(nextUser);
      toast.success("Login successful");
      return nextUser;
    }
    if (!allowDemoAuth) throw new Error("Supabase environment variables are missing.");
    const nextUser = demoUsers[email] || { ...demoUser, email: email || demoUser.email };
    setCurrentSessionLogin(true);
    setHasLoggedInThisSession(true);
    setUser(nextUser);
    cacheUser(nextUser);
    toast.success("Demo login successful");
    return nextUser;
  }

  async function register(values) {
    if (!values.termsAccepted || !values.privacyAccepted) throw new Error("Agree to the Terms of Use and acknowledge the Privacy Policy to register.");
    if (!values.fullName?.trim() || values.fullName.length > 120) throw new Error("Full name is required and must be 120 characters or fewer.");
    if (!values.studentNumber?.trim() || values.studentNumber.length > 40) throw new Error("Student number is required and must be 40 characters or fewer.");
    if (hasSupabaseConfig) {
      const { error } = await supabase.auth.signUp({
        email: values.email,
        password: values.password,
        options: {
          emailRedirectTo: `${window.location.origin}/login?confirmed=1`,
          data: {
            full_name: values.fullName,
            student_number: values.studentNumber,
            role: "Student",
            status: "Active",
          },
        },
      });
      if (error) throw error;
    }
    toast.success("Registration created. Please confirm your email before logging in.");
  }

  async function resetPassword(email) {
    if (hasSupabaseConfig) {
      const { error } = await supabase.functions.invoke("send-password-reset", { body: { email } });
      if (error) {
        const fallback = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/forgot-password`,
        });
        if (fallback.error) throw error;
      }
    }
    toast.success("Password reset link sent");
  }

  async function logout() {
    intentionalLogout.current = true;
    queryPersister.removeClient();
    if (hasSupabaseConfig) await supabase.auth.signOut();
    setCurrentSessionLogin(false);
    setHasLoggedInThisSession(false);
    queryClient.clear();
    setUser(null);
    cacheUser(null);
    toast.success("Logged out");
  }

  function updateCachedUser(updates) {
    setUser((current) => {
      if (!current) return current;
      const nextUser = { ...current, ...updates };
      cacheUser(nextUser);
      return nextUser;
    });
  }

  const value = useMemo(() => ({ user, loading, hasLoggedInThisSession, login, logout, register, resetPassword, updateCachedUser }), [user, loading, hasLoggedInThisSession]);

  return <AuthContext.Provider value={value}><Fragment key={user?.id || "signed-out"}>{children}</Fragment></AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
