import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { AudioWaveform, BrainCircuit, Eye, EyeOff, KeyRound, LockKeyhole, Mail, Radar, ScanFace, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

const particles = Array.from({ length: 18 }, (_, index) => ({
  id: index,
  left: `${(index * 43) % 100}%`,
  top: `${(index * 23) % 100}%`,
  delay: `${(index % 7) * 0.4}s`,
  size: `${4 + (index % 3) * 2}px`,
}));

export default function ForgotPassword() {
  const { resetPassword } = useAuth();
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

  return (
    <main className="ai-login-page relative min-h-screen overflow-hidden bg-[#0F172A] px-4 py-8 text-white sm:px-6 lg:px-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(6,182,212,0.22),transparent_28%),radial-gradient(circle_at_82%_28%,rgba(37,99,235,0.26),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.92),rgba(2,6,23,0.98))]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] bg-[size:44px_44px]" />
      {particles.map((particle) => (
        <span className="ai-login-particle absolute rounded-full bg-cyan-300/70 shadow-[0_0_18px_rgba(34,211,238,0.75)]" key={particle.id} style={{ left: particle.left, top: particle.top, width: particle.size, height: particle.size, animationDelay: particle.delay }} />
      ))}

      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-6xl items-center gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(380px,0.72fr)]">
        <div className="glass-panel relative overflow-hidden rounded-[28px] border border-cyan-300/20 bg-white/[0.07] p-7 shadow-[0_30px_90px_rgba(2,6,23,0.38)] backdrop-blur-2xl">
          <div className="mb-7 flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-400/15 text-cyan-200 shadow-[0_0_30px_rgba(6,182,212,0.25)]">
              <Radar size={25} />
            </div>
            <div>
              <p className="m-0 text-sm font-semibold text-cyan-100">Secure Recovery Console</p>
              <span className="text-xs font-medium text-slate-400">Identity reset monitored by AI signals</span>
            </div>
          </div>

          <div className="relative min-h-[390px] overflow-hidden rounded-3xl border border-white/10 bg-slate-950 p-5">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_22%,rgba(14,165,233,0.24),transparent_34%),linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.9))]" />
            <div className="relative z-10 grid gap-5">
              <div className="flex items-center justify-between rounded-2xl border border-cyan-300/20 bg-cyan-400/10 p-4">
                <div className="flex items-center gap-3 text-cyan-100"><KeyRound size={22} /><strong>{resetMode ? "Password Update" : "Reset Link Scan"}</strong></div>
                <span className="rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold text-emerald-200">SECURE</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                  <ScanFace className="mb-5 text-cyan-200" size={34} />
                  <div className="ai-face-frame relative mx-auto h-36 w-36 rounded-3xl border-[3px] border-cyan-300/90 shadow-[0_0_28px_rgba(34,211,238,0.55)]">
                    <span className="absolute -left-2 -top-2 h-8 w-8 rounded-tl-xl border-l-[5px] border-t-[5px] border-blue-400" />
                    <span className="absolute -right-2 -top-2 h-8 w-8 rounded-tr-xl border-r-[5px] border-t-[5px] border-blue-400" />
                    <span className="absolute -bottom-2 -right-2 h-8 w-8 rounded-br-xl border-b-[5px] border-r-[5px] border-blue-400" />
                    <span className="absolute -bottom-2 -left-2 h-8 w-8 rounded-bl-xl border-b-[5px] border-l-[5px] border-blue-400" />
                    <div className="absolute left-1/2 top-8 h-20 w-20 -translate-x-1/2 rounded-full bg-gradient-to-br from-slate-200 to-slate-500" />
                  </div>
                </div>
                <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                  <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-cyan-100"><AudioWaveform size={18} /> Recovery Signal</div>
                  <div className="flex h-36 items-end gap-2">
                    {[44, 78, 52, 88, 60, 96, 48, 74].map((height, index) => (
                      <span className="ai-wave-bar flex-1 rounded-full bg-gradient-to-t from-blue-600 to-cyan-300" key={index} style={{ height: `${height}%`, animationDelay: `${index * 0.08}s` }} />
                    ))}
                  </div>
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-900/70 p-5">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-cyan-100"><BrainCircuit size={18} /> Reset Protocol</div>
                {["Verify account channel", "Encrypt recovery session", "Issue monitored reset", "Return to secure login"].map((item) => (
                  <div className="mb-3 flex items-center justify-between text-sm text-slate-300" key={item}>
                    <span>{item}</span>
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.75)]" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <form className="ai-login-frame relative overflow-hidden rounded-[30px] border border-cyan-300/30 bg-white/[0.08] p-6 shadow-[0_35px_100px_rgba(2,6,23,0.45),0_0_45px_rgba(6,182,212,0.16)] backdrop-blur-2xl sm:p-8" onSubmit={handleSubmit(resetMode ? onUpdatePassword : onSendLink)}>
          <span className="ai-frame-corner left-0 top-0 rounded-tl-[30px] border-l-[5px] border-t-[5px]" />
          <span className="ai-frame-corner right-0 top-0 rounded-tr-[30px] border-r-[5px] border-t-[5px]" />
          <span className="ai-frame-corner bottom-0 right-0 rounded-br-[30px] border-b-[5px] border-r-[5px]" />
          <span className="ai-frame-corner bottom-0 left-0 rounded-bl-[30px] border-b-[5px] border-l-[5px]" />
          <span className="ai-scan-line" />

          <div className="relative z-10">
            <div className="mb-8 grid justify-items-center text-center">
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl border border-cyan-200/25 bg-cyan-400/10 text-cyan-100 shadow-[0_0_32px_rgba(34,211,238,0.3)]">
                <KeyRound size={32} />
              </div>
              <h1 className="m-0 text-3xl font-bold text-white">{resetMode ? "Update Password" : "Forgot Password"}</h1>
              <p className="mt-3 text-sm font-medium text-cyan-100/80">{resetMode ? "Create a new secure password for your monitored account." : "Enter your email to receive a secure reset link."}</p>
            </div>

            <div className="grid gap-5">
              {resetMode ? (
                <>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-slate-200">New Password</span>
                    <div className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-cyan-200/20 bg-slate-950/55 px-4 text-slate-100 shadow-[inset_0_0_24px_rgba(15,23,42,0.6)] transition focus-within:border-cyan-300/70">
                      <LockKeyhole className="text-cyan-200" size={20} />
                      <input className="w-full border-0 bg-transparent outline-none placeholder:text-slate-500" placeholder="New password" type={showPassword ? "text" : "password"} {...register("password", { required: "Password is required", minLength: { value: 6, message: "Password must be at least 6 characters" } })} />
                      <button className="grid h-9 w-9 place-items-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-cyan-100" onClick={() => setShowPassword((current) => !current)} type="button" aria-label={showPassword ? "Hide password" : "Show password"}>
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {errors.password?.message ? <small className="text-sm font-semibold text-red-300">{errors.password.message}</small> : null}
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-semibold text-slate-200">Confirm Password</span>
                    <div className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-cyan-200/20 bg-slate-950/55 px-4 text-slate-100 shadow-[inset_0_0_24px_rgba(15,23,42,0.6)] transition focus-within:border-cyan-300/70">
                      <ShieldCheck className="text-cyan-200" size={20} />
                      <input className="w-full border-0 bg-transparent outline-none placeholder:text-slate-500" placeholder="Confirm password" type={showConfirmPassword ? "text" : "password"} {...register("confirmPassword", { required: "Confirm password is required" })} />
                      <button className="grid h-9 w-9 place-items-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-cyan-100" onClick={() => setShowConfirmPassword((current) => !current)} type="button" aria-label={showConfirmPassword ? "Hide password" : "Show password"}>
                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {watch("password") !== watch("confirmPassword") ? <small className="text-sm font-semibold text-red-300">Passwords must match</small> : errors.confirmPassword?.message ? <small className="text-sm font-semibold text-red-300">{errors.confirmPassword.message}</small> : null}
                  </label>
                </>
              ) : (
                <label className="grid gap-2">
                  <span className="text-sm font-semibold text-slate-200">School ID / Email</span>
                  <div className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-cyan-200/20 bg-slate-950/55 px-4 text-slate-100 shadow-[inset_0_0_24px_rgba(15,23,42,0.6)] transition focus-within:border-cyan-300/70">
                    <Mail className="text-cyan-200" size={20} />
                    <input className="w-full border-0 bg-transparent outline-none placeholder:text-slate-500" placeholder="student@university.edu" type="email" {...register("email", { required: "Email is required" })} />
                  </div>
                  {errors.email?.message ? <small className="text-sm font-semibold text-red-300">{errors.email.message}</small> : null}
                </label>
              )}
            </div>

            <button className="ai-login-submit mt-7 flex min-h-[58px] w-full items-center justify-center gap-3 rounded-full bg-gradient-to-r from-[#2563EB] to-[#06B6D4] px-6 text-base font-extrabold text-white shadow-[0_18px_42px_rgba(37,99,235,0.36)] transition hover:shadow-[0_0_36px_rgba(6,182,212,0.48)] disabled:cursor-not-allowed disabled:opacity-70" disabled={isSubmitting || recovering} type="submit">
              <ShieldCheck size={21} />
              {recovering ? "Preparing Reset..." : isSubmitting ? "Processing..." : resetMode ? "Update Password" : "Send Reset Link"}
            </button>

            <div className="mt-6 flex justify-center text-sm text-slate-400">
              <Link className="font-semibold text-cyan-200 hover:text-white" to="/login">Back to Login</Link>
            </div>
          </div>
        </form>
      </section>
    </main>
  );
}
