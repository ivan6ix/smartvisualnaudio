import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button, Field } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm();
  const [resetMode, setResetMode] = useState(false);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!hasSupabaseConfig) return;
    const params = new window.URLSearchParams(`${window.location.search}&${window.location.hash.replace(/^#/, "")}`);
    if (params.get("type") === "recovery" || params.has("access_token") || params.has("code")) {
      setResetMode(true);
    }

    async function recoverSession() {
      setRecovering(true);
      try {
        const accessToken = params.get("access_token");
        const refreshToken = params.get("refresh_token");
        const code = params.get("code");

        if (accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) throw error;
          window.history.replaceState({}, "", "/forgot-password");
          setResetMode(true);
          return;
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
          window.history.replaceState({}, "", "/forgot-password");
          setResetMode(true);
        }
      } catch (error) {
        toast.error(error.message);
      } finally {
        setRecovering(false);
      }
    }

    if (params.has("access_token") || params.has("code")) void recoverSession();

    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setResetMode(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function onSendLink(values) {
    try {
      await resetPassword(values.email);
      reset();
    } catch (error) {
      toast.error(error.message);
    }
  }

  async function onUpdatePassword(values) {
    if (values.password !== values.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        toast.error("Reset link expired or invalid. Please request a new password reset link.");
        setResetMode(false);
        return;
      }
      const { error } = await supabase.auth.updateUser({ password: values.password });
      if (error) throw error;
      await supabase.auth.signOut();
      toast.success("Password updated. Please log in with your new password.");
      window.location.assign("/login");
    } catch (error) {
      toast.error(error.message);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit(resetMode ? onUpdatePassword : onSendLink)}>
        <div className="auth-title">
          <h1>{resetMode ? "Update Password" : "Forgot Password"}</h1>
          <p>{resetMode ? "Create your new password." : "Enter your email to receive a secure reset link."}</p>
        </div>
        {resetMode ? (
          <>
            <Field label="New Password" type="password" error={errors.password?.message} {...register("password", { required: "Password is required", minLength: { value: 6, message: "Password must be at least 6 characters" } })} />
            <Field label="Confirm Password" type="password" error={watch("password") !== watch("confirmPassword") ? "Passwords must match" : errors.confirmPassword?.message} {...register("confirmPassword", { required: "Confirm password is required" })} />
          </>
        ) : (
          <Field label="Email Address" type="email" error={errors.email?.message} {...register("email", { required: "Email is required" })} />
        )}
        <Button disabled={isSubmitting || recovering}>{recovering ? "Preparing Reset..." : isSubmitting ? "Processing..." : resetMode ? "Update Password" : "Send Reset Link"}</Button>
        <div className="auth-links"><Link to="/login">Back to Login</Link></div>
      </form>
    </main>
  );
}
