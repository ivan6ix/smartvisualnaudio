import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { ArrowUpRight, Eye, EyeOff, LockKeyhole, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../context/AuthContext";
import styles from "./Landing.module.css";

export default function SignInDialog({ open, onClose }) {
  const dialogRef = useRef(null);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const { register, handleSubmit, setFocus, resetField, formState: { errors, isSubmitting } } = useForm({ defaultValues: { email: "", password: "", remember: false } });

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    setFocus("email");
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open, setFocus]);

  useEffect(() => {
    if (!open) { resetField("password"); setShowPassword(false); setSubmitError(""); }
  }, [open, resetField]);

  async function onSubmit(values) {
    setSubmitError("");
    try {
      const signedInUser = await login(values.email, values.password);
      const destinations = { "Cluster Professor": "/cluster", Professor: "/professor", Student: "/student", Dean: "/dean" };
      navigate(destinations[signedInUser?.role] || "/");
    } catch (error) { setSubmitError(error.message); toast.error(error.message); }
  }

  function trapFocus(event) {
    if (event.key !== "Tab") return;
    const controls = [...dialogRef.current.querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]')];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return (
    <dialog ref={dialogRef} className={styles.dialog} aria-labelledby="sign-in-title" aria-describedby="sign-in-description" onKeyDown={trapFocus} onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <button type="button" className={`${styles.iconButton} ${styles.dialogClose}`} aria-label="Close sign in" onClick={onClose}><X size={20} /></button>
      <span className={styles.dialogEmblem}><LockKeyhole size={23} /></span>
      <p className={styles.eyebrow}>YOUR WORKSPACE AWAITS</p><h2 id="sign-in-title">Welcome back.</h2>
      <p id="sign-in-description" className={styles.muted}>Sign in to your Smart Proctoring account.</p>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <label htmlFor="landing-email">School email</label>
        <input id="landing-email" type="email" autoComplete="username" placeholder="you@university.edu" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "email-error" : undefined} {...register("email", { required: "Email is required", pattern: { value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: "Enter a valid email address" } })} />
        {errors.email && <small id="email-error" className={styles.formError}>{errors.email.message}</small>}
        <label htmlFor="landing-password">Password</label><div className={styles.passwordInput}>
          <input id="landing-password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="Enter your password" aria-invalid={Boolean(errors.password)} aria-describedby={errors.password ? "password-error" : undefined} {...register("password", { required: "Password is required" })} />
          <button type="button" className={styles.iconButton} aria-label={showPassword ? "Hide password" : "Show password"} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
        </div>
        {errors.password && <small id="password-error" className={styles.formError}>{errors.password.message}</small>}
        <div className={styles.formOptions}><label><input type="checkbox" {...register("remember")} /> Remember me</label><Link to="/forgot-password">Forgot password?</Link></div>
        {submitError && <p role="alert" className={styles.formError}>{submitError}</p>}
        <button className={styles.primaryButton} type="submit" disabled={isSubmitting}>{isSubmitting ? "Authenticating…" : "Sign in"}<ArrowUpRight size={19} /></button>
      </form>
      <p className={styles.registerPrompt}>New here? <Link to="/register">Create account <ArrowUpRight size={14} /></Link></p>
      <div className={styles.dialogLegal}><Link to="/privacy" target="_blank" rel="noopener">Privacy</Link><Link to="/terms" target="_blank" rel="noopener">Terms</Link><Link to="/storage" target="_blank" rel="noopener">Cookies & storage</Link></div>
    </dialog>
  );
}
