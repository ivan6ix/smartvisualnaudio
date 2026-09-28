import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { ArrowUpRight, BookOpen, Check, Eye, EyeOff, GraduationCap, LockKeyhole, Moon, ShieldCheck, Sun } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import Brand from "../components/landing/Brand";
import styles from "../components/landing/Landing.module.css";

const RobotScene = lazy(() => import("../components/landing/RobotScene"));

export default function Login() {
  const { login } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const visualRef = useRef(null);
  const confirmationShown = useRef(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const { register, handleSubmit, setFocus, formState: { errors, isSubmitting } } = useForm({ defaultValues: { email: "", password: "", remember: false } });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Sign in - Smart Proctoring";
    setFocus("email");
    return () => { document.title = previousTitle; };
  }, [setFocus]);

  useEffect(() => {
    if (searchParams.get("confirmed") === "1" && !confirmationShown.current) {
      confirmationShown.current = true;
      toast.success("Email confirmed. You can now log in.");
    }
  }, [searchParams]);

  async function onSubmit(values) {
    setSubmitError("");
    try {
      const signedInUser = await login(values.email, values.password);
      const destinations = { "Cluster Professor": "/cluster", Professor: "/professor", Student: "/student", Dean: "/dean" };
      navigate(destinations[signedInUser?.role] || "/");
    } catch (error) {
      setSubmitError(error.message);
      toast.error(error.message);
    }
  }

  function fieldError(name) {
    return errors[name] ? <small id={`login-${name}-error`} className={styles.formError}>{errors[name].message}</small> : null;
  }

  function fieldA11y(name) {
    return { "aria-invalid": Boolean(errors[name]), "aria-describedby": errors[name] ? `login-${name}-error` : undefined };
  }

  return (
    <div className={`${styles.page} ${styles.registerPage}`} data-theme={theme}>
      <a className={styles.skipLink} href="#login-form">Skip to sign in</a>
      <header className={styles.header}>
        <Link to="/landing" aria-label="Smart Proctoring landing page"><Brand /></Link>
        <div className={styles.headerActions}>
          <button className={styles.iconButton} type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button>
          <Link className={styles.textLink} to="/register">Create account <ArrowUpRight size={16} /></Link>
        </div>
      </header>
      <main className={styles.registerLayout}>
        <section className={styles.registerIntro} aria-labelledby="login-intro-heading">
          <p className={styles.eyebrow}>YOUR WORKSPACE AWAITS</p>
          <h1 id="login-intro-heading">Confidence continues.<br /><span>Welcome back.</span></h1>
          <p>Return to your courses, examinations, reports, and monitored assessment workspace.</p>
          <div className={styles.registerRobot} ref={visualRef}>
            <div className={styles.registerHalo} />
            <div className={`${styles.sceneFrame} ${styles.registerSceneFrame}`}>
              <img className={styles.robotPoster} src="/landing/robot-poster.png" alt="Your friendly Smart Proctoring robot companion" width="900" height="1000" />
              <Suspense fallback={null}><RobotScene heroRef={visualRef} theme={theme} paused={false} /></Suspense>
            </div>
            <span><ShieldCheck size={16} /> Watching the page with you.</span>
          </div>
          <div className={styles.registerBenefits}>
            <span><BookOpen size={16} /> Continue your workflow</span>
            <span><GraduationCap size={16} /> Access assigned exams</span>
            <span><Check size={16} /> Review results and updates</span>
          </div>
        </section>
        <section className={styles.registerCard} aria-labelledby="login-heading">
          <span className={styles.dialogEmblem}><LockKeyhole size={25} /></span>
          <p className={styles.eyebrow}>A PLACE IN YOUR ACADEMIC COMMUNITY</p>
          <h2 id="login-heading">Sign in.</h2>
          <p className={styles.muted}>Enter your account details to continue.</p>
          <form id="login-form" className={styles.registerForm} onSubmit={handleSubmit(onSubmit)} noValidate tabIndex={-1}>
            <div className={styles.registerFields}>
              <div className={styles.fullWidth}>
                <label htmlFor="login-email">School email</label>
                <input id="login-email" type="email" autoComplete="username" placeholder="you@university.edu" {...fieldA11y("email")} {...register("email", { required: "Email is required", pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address" } })} />
                {fieldError("email")}
              </div>
              <div className={styles.fullWidth}>
                <label htmlFor="login-password">Password</label>
                <div className={styles.passwordInput}>
                  <input id="login-password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" {...fieldA11y("password")} {...register("password", { required: "Password is required" })} />
                  <button type="button" className={styles.iconButton} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                </div>
                {fieldError("password")}
              </div>
            </div>
            <div className={styles.formOptions}>
              <label><input type="checkbox" {...register("remember")} /> Remember me</label>
              <Link to="/forgot-password">Forgot password?</Link>
            </div>
            {submitError && <p className={styles.formError} role="alert">{submitError}</p>}
            <button className={styles.primaryButton} disabled={isSubmitting} type="submit">{isSubmitting ? "Authenticating..." : "Sign in"}<ArrowUpRight size={18} /></button>
            <p className={styles.registerPrompt}>New here? <Link to="/register">Create account <ArrowUpRight size={14} /></Link></p>
          </form>
          <div className={styles.dialogLegal}><Link to="/privacy" target="_blank" rel="noopener">Privacy Policy</Link><Link to="/terms" target="_blank" rel="noopener">Terms of Use</Link><Link to="/storage" target="_blank" rel="noopener">Cookies & Storage</Link></div>
        </section>
      </main>
      <footer className={`${styles.footer} ${styles.registerFooter}`}><p>Smart Proctoring Through Audio & Visual Monitoring</p><p>Built for learning. Designed for confidence.</p></footer>
    </div>
  );
}
