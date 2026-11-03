import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { ArrowUpRight, Eye, EyeOff, KeyRound, LockKeyhole, Moon, ShieldCheck, Sun, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import { writeAccountAuditLog } from "../lib/accountAudit";
import { PASSWORD_MIN_LENGTH, updateOwnPassword, validateNewPassword } from "../lib/settingsSecurity";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import Brand from "../components/landing/Brand";
import styles from "../components/landing/Landing.module.css";

const RobotScene = lazy(() => import("../components/landing/RobotScene"));
const roleHome = { Admin: "/", Dean: "/dean", Professor: "/professor", "Cluster Professor": "/cluster", Student: "/student" };

// Shown after sign-in to accounts whose password the Admin set (new or reset). Every other page redirects here
// until the user picks their own password.
export default function ChangePassword() {
  const { user, loading, hasLoggedInThisSession, logout, updateCachedUser } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const visualRef = useRef(null);
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const { register, handleSubmit, setFocus, formState: { isSubmitting } } = useForm({ defaultValues: { newPassword: "", confirmPassword: "" } });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Set a new password - Smart Proctoring";
    return () => { document.title = previousTitle; };
  }, []);

  useEffect(() => {
    if (user?.mustChangePassword) setFocus("newPassword");
  }, [setFocus, user?.mustChangePassword]);

  if (loading) return null;
  if (!hasLoggedInThisSession || !user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to={roleHome[user.role] || "/"} replace />;

  async function onSubmit(values) {
    setSubmitError("");
    const validationError = validateNewPassword(values);
    if (validationError) {
      setSubmitError(validationError);
      return;
    }
    if (hasSupabaseConfig) {
      const { error } = await updateOwnPassword(supabase, values.newPassword);
      if (error) {
        setSubmitError(error.code === "same_password" ? "Choose a password different from the temporary one." : error.message || "Unable to update password.");
        return;
      }
      await writeAccountAuditLog({
        supabase,
        user,
        eventType: "account.password_changed",
        action: "Password Changed",
        description: "A user replaced the temporary password set by an admin.",
      });
    }
    updateCachedUser({ mustChangePassword: false });
    toast.success("Password updated");
    navigate(roleHome[user.role] || "/", { replace: true });
  }

  async function signOut(event) {
    event.preventDefault();
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className={`${styles.page} ${styles.registerPage}`} data-theme={theme}>
      <a className={styles.skipLink} href="#change-password-form">Skip to form</a>
      <header className={styles.header}>
        <Brand />
        <div className={styles.headerActions}>
          <button className={styles.iconButton} type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
        </div>
      </header>
      <main className={styles.registerLayout}>
        <section className={styles.registerIntro} aria-labelledby="change-password-intro-heading">
          <p className={styles.eyebrow}>ACCOUNT SECURITY</p>
          <h1 id="change-password-intro-heading">One last step.<br /><span>Make it yours.</span></h1>
          <p>Your account uses a temporary password set by the administrator. Choose your own before continuing.</p>
          <div className={styles.registerRobot} ref={visualRef}>
            <div className={styles.registerHalo} />
            <div className={`${styles.sceneFrame} ${styles.registerSceneFrame}`}>
              <img className={styles.robotPoster} src="/landing/robot-poster.png" alt="Your friendly Smart Proctoring robot companion" width="900" height="1000" />
              <Suspense fallback={null}><RobotScene heroRef={visualRef} theme={theme} paused={false} /></Suspense>
            </div>
            <span><ShieldCheck size={16} /> Watching the page with you.</span>
          </div>
          <div className={styles.registerBenefits}>
            <span><KeyRound size={16} /> Only you will know it</span>
            <span><LockKeyhole size={16} /> At least {PASSWORD_MIN_LENGTH} characters</span>
            <span><UserCheck size={16} /> Asked once, then you are in</span>
          </div>
        </section>
        <section className={styles.registerCard} aria-labelledby="change-password-heading">
          <span className={styles.dialogEmblem}><LockKeyhole size={25} /></span>
          <p className={styles.eyebrow}>SET A NEW PASSWORD</p>
          <h2 id="change-password-heading">Set a new password.</h2>
          <p className={styles.muted}>Signed in as {user.email}.</p>
          <form id="change-password-form" className={styles.registerForm} onSubmit={handleSubmit(onSubmit)} noValidate tabIndex={-1}>
            <div className={styles.registerFields}>
              <div className={styles.fullWidth}>
                <label htmlFor="change-password-new">New password</label>
                <div className={styles.passwordInput}>
                  <input id="change-password-new" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`} {...register("newPassword")} />
                  <button type="button" className={styles.iconButton} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword((current) => !current)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                </div>
              </div>
              <div className={styles.fullWidth}>
                <label htmlFor="change-password-confirm">Confirm password</label>
                <input id="change-password-confirm" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="Re-enter your password" {...register("confirmPassword")} />
              </div>
            </div>
            {submitError && <p className={styles.formError} role="alert">{submitError}</p>}
            <button className={styles.primaryButton} disabled={isSubmitting} type="submit">{isSubmitting ? "Saving..." : "Save and continue"}<ArrowUpRight size={18} /></button>
            <p className={styles.registerPrompt}>Not now? <Link to="/login" onClick={signOut}>Sign out <ArrowUpRight size={14} /></Link></p>
          </form>
        </section>
      </main>
      <footer className={`${styles.footer} ${styles.registerFooter}`}><p>Smart Proctoring Through Audio & Visual Monitoring</p><p>Built for learning. Designed for confidence.</p></footer>
    </div>
  );
}
