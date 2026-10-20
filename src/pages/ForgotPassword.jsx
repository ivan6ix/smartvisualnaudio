import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { ArrowUpRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, Moon, ShieldCheck, Sun } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import Brand from "../components/landing/Brand";
import styles from "../components/landing/Landing.module.css";

const RobotScene = lazy(() => import("../components/landing/RobotScene"));

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const visualRef = useRef(null);
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm();
  const [resetMode, setResetMode] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

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
          const { error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
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

  const fieldErrorId = (name) => `forgot-${name}-error`;
  const invalid = (name) => ({ "aria-invalid": Boolean(errors[name]), "aria-describedby": errors[name] ? fieldErrorId(name) : undefined });
  const passwordsMismatch = resetMode && watch("confirmPassword") && watch("password") !== watch("confirmPassword");

  return (
    <div className={`${styles.page} ${styles.registerPage}`} data-theme={theme}>
      <a className={styles.skipLink} href="#forgot-form">Skip to form</a>
      <header className={styles.header}>
        <Link to="/landing" aria-label="Smart Proctoring landing page"><Brand /></Link>
        <div className={styles.headerActions}>
          <button className={styles.iconButton} type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
          <Link className={styles.textLink} to="/login">Back to sign in <ArrowUpRight size={16} /></Link>
        </div>
      </header>
      <main className={styles.registerLayout}>
        <section className={styles.registerIntro} aria-labelledby="forgot-intro-heading">
          <p className={styles.eyebrow}>ACCOUNT RECOVERY</p>
          <h1 id="forgot-intro-heading">{resetMode ? <>Almost there.<br /><span>Choose a new password.</span></> : <>Locked out?<br /><span>We will help you in.</span></>}</h1>
          <p>{resetMode ? "Your reset link was verified. Set a new password to return to your workspace." : "Enter your school email and we will send a secure link to reset your password."}</p>
          <div className={styles.registerRobot} ref={visualRef}>
            <div className={styles.registerHalo} />
            <div className={`${styles.sceneFrame} ${styles.registerSceneFrame}`}>
              <img className={styles.robotPoster} src="/landing/robot-poster.png" alt="Your friendly Smart Proctoring robot companion" width="900" height="1000" />
              <Suspense fallback={null}><RobotScene heroRef={visualRef} theme={theme} paused={false} /></Suspense>
            </div>
            <span><ShieldCheck size={16} /> Watching the page with you.</span>
          </div>
          <div className={styles.registerBenefits}>
            <span><Mail size={16} /> Check your inbox for the link</span>
            <span><KeyRound size={16} /> Open it on this device</span>
            <span><LockKeyhole size={16} /> Set a new password</span>
          </div>
        </section>
        <section className={styles.registerCard} aria-labelledby="forgot-heading">
          <span className={styles.dialogEmblem}><KeyRound size={25} /></span>
          <p className={styles.eyebrow}>{resetMode ? "SET A NEW PASSWORD" : "RESET YOUR PASSWORD"}</p>
          <h2 id="forgot-heading">{resetMode ? "Update password." : "Forgot password?"}</h2>
          <p className={styles.muted}>{resetMode ? "Create a new password for your account." : "Enter your school email to receive a reset link."}</p>
          <form id="forgot-form" className={styles.registerForm} onSubmit={handleSubmit(resetMode ? onUpdatePassword : onSendLink)} noValidate tabIndex={-1}>
            <div className={styles.registerFields}>
              {resetMode ? (
                <>
                  <div className={styles.fullWidth}>
                    <label htmlFor="forgot-password">New password</label>
                    <div className={styles.passwordInput}>
                      <input id="forgot-password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="At least 6 characters" {...invalid("password")} {...register("password", { required: "Password is required", minLength: { value: 6, message: "Password must be at least 6 characters" } })} />
                      <button type="button" className={styles.iconButton} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                    </div>
                    {errors.password?.message ? <small id={fieldErrorId("password")} className={styles.formError}>{errors.password.message}</small> : null}
                  </div>
                  <div className={styles.fullWidth}>
                    <label htmlFor="forgot-confirm">Confirm password</label>
                    <div className={styles.passwordInput}>
                      <input id="forgot-confirm" type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" placeholder="Re-enter your password" {...invalid("confirmPassword")} {...register("confirmPassword", { required: "Confirm password is required" })} />
                      <button type="button" className={styles.iconButton} aria-label={showConfirmPassword ? "Hide password" : "Show password"} onClick={() => setShowConfirmPassword((current) => !current)}>{showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                    </div>
                    {passwordsMismatch ? <small className={styles.formError}>Passwords must match</small> : errors.confirmPassword?.message ? <small id={fieldErrorId("confirmPassword")} className={styles.formError}>{errors.confirmPassword.message}</small> : null}
                  </div>
                </>
              ) : (
                <div className={styles.fullWidth}>
                  <label htmlFor="forgot-email">School email</label>
                  <input id="forgot-email" type="email" autoComplete="username" placeholder="you@university.edu" {...invalid("email")} {...register("email", { required: "Email is required" })} />
                  {errors.email?.message ? <small id={fieldErrorId("email")} className={styles.formError}>{errors.email.message}</small> : null}
                </div>
              )}
            </div>
            <button className={styles.primaryButton} disabled={isSubmitting || recovering} type="submit">{recovering ? "Preparing reset..." : isSubmitting ? "Processing..." : resetMode ? "Update password" : "Send reset link"}<ArrowUpRight size={18} /></button>
            <p className={styles.registerPrompt}>Remembered it? <Link to="/login">Back to sign in <ArrowUpRight size={14} /></Link></p>
          </form>
          <div className={styles.dialogLegal}><Link to="/privacy" target="_blank" rel="noopener">Privacy Policy</Link><Link to="/terms" target="_blank" rel="noopener">Terms of Use</Link><Link to="/storage" target="_blank" rel="noopener">Cookies & Storage</Link></div>
        </section>
      </main>
      <footer className={`${styles.footer} ${styles.registerFooter}`}><p>Smart Proctoring Through Audio & Visual Monitoring</p><p>Built for learning. Designed for confidence.</p></footer>
    </div>
  );
}
