import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { ArrowLeft, ArrowUpRight, BookOpen, Check, Eye, EyeOff, GraduationCap, MailCheck, Moon, ShieldCheck, Sun } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { useTheme } from "../context/ThemeContext";
import Brand from "../components/landing/Brand";
import styles from "../components/landing/Landing.module.css";

const RobotScene = lazy(() => import("../components/landing/RobotScene"));

export default function Register() {
  const { register: createStudent } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { register, handleSubmit, getValues, reset, formState: { errors, isSubmitting } } = useForm();
  const registerVisualRef = useRef(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [created, setCreated] = useState(false);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Create account — Smart Proctoring";
    return () => { document.title = previousTitle; };
  }, []);

  async function onSubmit(values) {
    if (values.password !== values.confirmPassword) { toast.error("Passwords do not match"); return; }
    setSubmitError("");
    setCreated(false);
    try {
      await createStudent(values);
      reset();
      setShowPassword(false);
      setShowConfirmPassword(false);
      setCreated(true);
    } catch (error) { setSubmitError(error.message); toast.error(error.message); }
  }

  function fieldError(name) {
    return errors[name] ? <small id={`register-${name}-error`} className={styles.formError}>{errors[name].message}</small> : null;
  }

  function fieldA11y(name) {
    return { "aria-invalid": Boolean(errors[name]), "aria-describedby": errors[name] ? `register-${name}-error` : undefined };
  }

  return (
    <div className={`${styles.page} ${styles.registerPage}`} data-theme={theme}>
      <a className={styles.skipLink} href="#registration-form">Skip to registration</a>
      <header className={styles.header}>
        <Link to="/landing" aria-label="Smart Proctoring landing page"><Brand /></Link>
        <div className={styles.headerActions}><button className={styles.iconButton} type="button" onClick={toggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>{theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}</button><Link className={styles.textLink} to="/login?signin=1">Sign in <ArrowUpRight size={16} /></Link></div>
      </header>
      <main className={styles.registerLayout}>
        <section className={styles.registerIntro} aria-labelledby="register-intro-heading">
          <Link className={styles.backLink} to="/landing"><ArrowLeft size={15} /> Back to home</Link>
          <p className={styles.eyebrow}>YOUR NEXT CHAPTER STARTS HERE</p>
          <h1 id="register-intro-heading">A little preparation.<br /><span>A lot of possibility.</span></h1>
          <p>Join your academic community. Your courses, examinations, and progress—all in one considered workspace.</p>
          <div className={styles.registerRobot} ref={registerVisualRef}>
            <div className={styles.registerHalo} />
            <div className={`${styles.sceneFrame} ${styles.registerSceneFrame}`}>
              <img className={styles.robotPoster} src="/landing/robot-poster.png" alt="Your friendly Smart Proctoring robot companion" width="900" height="1000" />
              <Suspense fallback={null}><RobotScene heroRef={registerVisualRef} theme={theme} paused={false} /></Suspense>
            </div>
            <span><ShieldCheck size={16} /> Built for your learning journey.</span>
          </div>
          <div className={styles.registerBenefits}><span><BookOpen size={16} /> Connect with your courses</span><span><GraduationCap size={16} /> Take your next assessment</span><span><Check size={16} /> Follow your progress</span></div>
        </section>
        <section className={styles.registerCard} aria-labelledby="register-heading">
          <span className={styles.dialogEmblem}><GraduationCap size={25} /></span>
          <p className={styles.eyebrow}>A PLACE IN YOUR ACADEMIC COMMUNITY</p>
          <h2 id="register-heading">Create your account.</h2>
          <p className={styles.muted}>A few details, and you’re one step closer.</p>
          {created && <div className={styles.registerSuccess} role="status"><MailCheck size={23} /><div><strong>Check your inbox.</strong><p>Registration created. Please confirm your email before signing in.</p><Link to="/login?signin=1">Continue to sign in <ArrowUpRight size={14} /></Link></div></div>}
          <form id="registration-form" className={styles.registerForm} onSubmit={handleSubmit(onSubmit)} noValidate tabIndex={-1}>
            <div className={styles.registerFields}>
              <div className={styles.fullWidth}><label htmlFor="register-full-name">Full name</label><input id="register-full-name" autoComplete="name" placeholder="Juan Dela Cruz" {...fieldA11y("fullName")} {...register("fullName", { required: "Full name is required" })} />{fieldError("fullName")}</div>
              <div><label htmlFor="register-student-number">Student number</label><input id="register-student-number" placeholder="2026-0001" {...fieldA11y("studentNumber")} {...register("studentNumber", { required: "Student number is required" })} />{fieldError("studentNumber")}</div>
              <div><label htmlFor="register-email">School email</label><input id="register-email" type="email" autoComplete="email" placeholder="you@university.edu" {...fieldA11y("email")} {...register("email", { required: "Email is required", pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address" } })} />{fieldError("email")}</div>
              <div><label htmlFor="register-password">Password</label><div className={styles.passwordInput}><input id="register-password" type={showPassword ? "text" : "password"} autoComplete="new-password" placeholder="At least 6 characters" {...fieldA11y("password")} {...register("password", { required: "Password is required", minLength: { value: 6, message: "Password must be at least 6 characters" } })} /><button type="button" className={styles.iconButton} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{fieldError("password")}</div>
              <div><label htmlFor="register-confirm-password">Confirm password</label><div className={styles.passwordInput}><input id="register-confirm-password" type={showConfirmPassword ? "text" : "password"} autoComplete="new-password" placeholder="One more time" {...fieldA11y("confirmPassword")} {...register("confirmPassword", { required: "Confirm password is required", validate: (value) => value === getValues("password") || "Passwords must match" })} /><button type="button" className={styles.iconButton} aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"} onClick={() => setShowConfirmPassword(!showConfirmPassword)}>{showConfirmPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>{fieldError("confirmPassword")}</div>
            </div>
            <div className={styles.agreements}>
              <label><input type="checkbox" {...fieldA11y("termsAccepted")} {...register("termsAccepted", { required: "Please agree to the Terms of Use." })} /><span>I agree to the <Link to="/terms" target="_blank" rel="noopener">Terms of Use</Link>.</span></label>{fieldError("termsAccepted")}
              <label><input type="checkbox" {...fieldA11y("privacyAccepted")} {...register("privacyAccepted", { required: "Please acknowledge the Privacy Policy." })} /><span>I acknowledge the <Link to="/privacy" target="_blank" rel="noopener">Privacy Policy</Link>.</span></label>{fieldError("privacyAccepted")}
            </div>
            {submitError && <p className={styles.formError} role="alert">{submitError}</p>}
            <button className={styles.primaryButton} disabled={isSubmitting} type="submit">{isSubmitting ? "Creating account…" : "Create student account"}<ArrowUpRight size={18} /></button>
            <p className={styles.registerPrompt}>Already part of the community? <Link to="/login?signin=1">Sign in <ArrowUpRight size={14} /></Link></p>
          </form>
          <div className={styles.dialogLegal}><Link to="/privacy" target="_blank" rel="noopener">Privacy Policy</Link><Link to="/terms" target="_blank" rel="noopener">Terms of Use</Link><Link to="/storage" target="_blank" rel="noopener">Cookies & Storage</Link></div>
        </section>
      </main>
      <footer className={`${styles.footer} ${styles.registerFooter}`}><p>Smart Proctoring Through Audio & Visual Monitoring</p><p>Built for learning. Designed for confidence.</p></footer>
    </div>
  );
}
