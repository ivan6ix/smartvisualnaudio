import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

const AuthContext = createContext(null);

const demoUser = {
  id: "demo-admin",
  email: "admin@university.edu",
  role: "Admin",
  fullName: "Admin User",
};

const demoUsers = {
  "cluster@university.edu": {
    id: "demo-cluster",
    email: "cluster@university.edu",
    role: "Cluster Professor",
    fullName: "Prof. Nolan Lim",
    status: "Active",
    createdAt: "2026-05-01",
  },
  "professor@university.edu": {
    id: "demo-professor",
    email: "professor@university.edu",
    role: "Professor",
    fullName: "Dr. Maria Santos",
    status: "Active",
    createdAt: "2026-04-20",
  },
  "dean@university.edu": {
    id: "demo-dean",
    email: "dean@university.edu",
    role: "Dean",
    fullName: "Dean Angela Cruz",
    status: "Active",
    createdAt: "2026-04-18",
  },
  "student@university.edu": {
    id: "demo-student",
    email: "student@university.edu",
    role: "Student",
    fullName: "Ivan Caburnay",
    status: "Active",
    createdAt: "2026-05-31",
  },
};

const allowDemoAuth = !hasSupabaseConfig && import.meta.env.DEV;

async function mapAuthUser(authUser) {
  if (!authUser) return null;

  let profile = null;
  if (hasSupabaseConfig) {
    const { data } = await supabase
      .from("profiles")
      .select("role, full_name, status")
      .eq("id", authUser.id)
      .maybeSingle();
    profile = data;
  }

  return {
    id: authUser.id,
    email: authUser.email,
    role: profile?.role || authUser.user_metadata?.role || "Student",
    fullName: profile?.full_name || authUser.user_metadata?.full_name || authUser.email,
    status: profile?.status || authUser.user_metadata?.status,
  };
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(allowDemoAuth ? demoUser : null);
  const [loading, setLoading] = useState(Boolean(hasSupabaseConfig));

  useEffect(() => {
    if (!hasSupabaseConfig) return;

    supabase.auth.getSession().then(async ({ data }) => {
      const authUser = data.session?.user;
      setUser(await mapAuthUser(authUser));
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const authUser = session?.user;
      setUser(await mapAuthUser(authUser));
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function login(email, password) {
    if (hasSupabaseConfig) {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const nextUser = await mapAuthUser(data.user);
      setUser(nextUser);
      toast.success("Login successful");
      return nextUser;
    }
    if (!allowDemoAuth) throw new Error("Supabase environment variables are missing.");
    const nextUser = demoUsers[email] || { ...demoUser, email: email || demoUser.email };
    setUser(nextUser);
    toast.success("Demo login successful");
    return nextUser;
  }

  async function register(values) {
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
            status: "Pending",
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
    if (hasSupabaseConfig) await supabase.auth.signOut();
    setUser(null);
    toast.success("Logged out");
  }

  const value = useMemo(() => ({ user, loading, login, logout, register, resetPassword }), [user, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
