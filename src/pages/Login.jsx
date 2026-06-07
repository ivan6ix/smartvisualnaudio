import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Activity, AudioWaveform, BrainCircuit, Camera, Eye, EyeOff, LockKeyhole, Mail, Radar, ScanFace, ShieldCheck, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";

const particles = Array.from({ length: 24 }, (_, index) => ({
  id: index,
  left: `${(index * 37) % 100}%`,
  top: `${(index * 19) % 100}%`,
  delay: `${(index % 8) * 0.45}s`,
  size: `${4 + (index % 4) * 2}px`,
}));

const floatingIcons = [
  { Icon: ScanFace, className: "left-[6%] top-[16%]" },
  { Icon: AudioWaveform, className: "right-[8%] top-[22%]" },
  { Icon: ShieldCheck, className: "left-[9%] bottom-[18%]" },
  { Icon: BrainCircuit, className: "right-[10%] bottom-[14%]" },
];

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [showPassword, setShowPassword] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues: { email: "", password: "", remember: false } });

  useEffect(() => {
    if (searchParams.get("confirmed") === "1") {
      toast.success("Email confirmed. You can now log in.");
    }
  }, [searchParams]);

  async function onSubmit(values) {
    try {
      const signedInUser = await login(values.email, values.password);
      if (signedInUser?.role === "Cluster Professor") {
        navigate("/cluster");
        return;
      }
      if (signedInUser?.role === "Professor") {
        navigate("/professor");
        return;
      }
      if (signedInUser?.role === "Student") {
        navigate("/student");
        return;
      }
      if (signedInUser?.role === "Dean") {
        navigate("/dean");
        return;
      }
      navigate("/");
    } catch (error) {
      toast.error(error.message);
    }
  }

  return (
    <main className="ai-login-page relative min-h-screen overflow-hidden bg-[#0F172A] px-4 py-8 text-white sm:px-6 lg:px-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(6,182,212,0.22),transparent_28%),radial-gradient(circle_at_82%_28%,rgba(37,99,235,0.26),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0.92),rgba(2,6,23,0.98))]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] bg-[size:44px_44px]" />

      {particles.map((particle) => (
        <span
          className="ai-login-particle absolute rounded-full bg-cyan-300/70 shadow-[0_0_18px_rgba(34,211,238,0.75)]"
          key={particle.id}
          style={{ left: particle.left, top: particle.top, width: particle.size, height: particle.size, animationDelay: particle.delay }}
        />
      ))}

      {floatingIcons.map(({ Icon, className }, index) => (
        <div className={`ai-floating-icon pointer-events-none absolute hidden rounded-2xl border border-cyan-300/20 bg-white/5 p-3 text-cyan-200 shadow-[0_0_32px_rgba(6,182,212,0.2)] backdrop-blur-md lg:block ${className}`} key={index}>
          <Icon size={22} />
        </div>
      ))}

      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-7xl items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.85fr)]">
        <div className="glass-panel relative overflow-hidden rounded-[28px] border border-cyan-300/20 bg-white/[0.07] p-5 shadow-[0_30px_90px_rgba(2,6,23,0.38)] backdrop-blur-2xl sm:p-7 lg:p-8">
          <div className="mb-7 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-400/15 text-cyan-200 shadow-[0_0_30px_rgba(6,182,212,0.25)]">
                <Radar size={25} />
              </div>
              <div>
                <p className="m-0 text-sm font-semibold text-cyan-100">AI Proctoring Console</p>
                <span className="text-xs font-medium text-slate-400">Live exam integrity view</span>
              </div>
            </div>
            <div className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-200">ACTIVE</div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_220px]">
            <div className="relative min-h-[380px] overflow-hidden rounded-3xl border border-white/10 bg-slate-950 shadow-[inset_0_0_40px_rgba(15,23,42,0.95)]">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(14,165,233,0.2),transparent_32%),linear-gradient(180deg,rgba(15,23,42,0.08),rgba(15,23,42,0.86))]" />
              <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-red-300/30 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-200">
                <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.9)]" />
                REC
              </div>
              <div className="absolute right-5 top-5 flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-cyan-100">
                <Camera size={14} />
                Webcam 01
              </div>

              <div className="absolute inset-x-8 bottom-0 top-20 flex items-end justify-center">
                <div className="relative h-[285px] w-[235px]">
                  <div className="absolute left-1/2 top-2 h-28 w-28 -translate-x-1/2 rounded-full border border-cyan-200/20 bg-[linear-gradient(145deg,#dbeafe,#94a3b8)] shadow-[0_0_40px_rgba(6,182,212,0.18)]" />
                  <div className="absolute left-1/2 top-32 h-40 w-48 -translate-x-1/2 rounded-t-[70px] bg-[linear-gradient(145deg,#1e293b,#475569)]" />
                  <div className="absolute left-1/2 top-10 h-20 w-[94px] -translate-x-1/2 rounded-[32px] bg-[linear-gradient(145deg,#f8fafc,#cbd5e1)]" />
                  <div className="absolute left-[88px] top-[70px] h-2 w-2 rounded-full bg-slate-900" />
                  <div className="absolute right-[88px] top-[70px] h-2 w-2 rounded-full bg-slate-900" />
                  <div className="absolute left-1/2 top-[92px] h-1 w-8 -translate-x-1/2 rounded-full bg-slate-500" />
                  <div className="ai-face-frame absolute left-1/2 top-5 h-28 w-32 -translate-x-1/2 rounded-2xl border-[3px] border-cyan-300/90 shadow-[0_0_28px_rgba(34,211,238,0.55)]">
                    <span className="absolute -left-2 -top-2 h-7 w-7 rounded-tl-xl border-l-[5px] border-t-[5px] border-blue-400" />
                    <span className="absolute -right-2 -top-2 h-7 w-7 rounded-tr-xl border-r-[5px] border-t-[5px] border-blue-400" />
                    <span className="absolute -bottom-2 -right-2 h-7 w-7 rounded-br-xl border-b-[5px] border-r-[5px] border-blue-400" />
                    <span className="absolute -bottom-2 -left-2 h-7 w-7 rounded-bl-xl border-b-[5px] border-l-[5px] border-blue-400" />
                  </div>
                </div>
              </div>

              <div className="absolute bottom-5 left-5 right-5 grid gap-3 rounded-2xl border border-white/10 bg-slate-950/70 p-4 backdrop-blur-md">
                <div className="flex items-center justify-between text-xs text-slate-300">
                  <span>Face confidence</span>
                  <strong className="text-cyan-200">98.7%</strong>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <span className="block h-full w-[91%] rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" />
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-3xl border border-white/10 bg-slate-950/50 p-4 backdrop-blur">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-cyan-100"><Activity size={17} /> Audio Waveform</div>
                <div className="flex h-24 items-end gap-2">
                  {[34, 64, 42, 82, 54, 92, 46, 72, 38, 68, 50, 88].map((height, index) => (
                    <span className="ai-wave-bar flex-1 rounded-full bg-gradient-to-t from-blue-600 to-cyan-300" key={index} style={{ height: `${height}%`, animationDelay: `${index * 0.08}s` }} />
                  ))}
                </div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-slate-950/50 p-4 backdrop-blur">
                <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-cyan-100"><BrainCircuit size={17} /> Integrity Signals</div>
                {["Face locked", "Voice level normal", "No extra device", "Focus stable"].map((item) => (
                  <div className="mb-3 flex items-center justify-between text-sm text-slate-300" key={item}>
                    <span>{item}</span>
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.75)]" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <form className="ai-login-frame relative overflow-hidden rounded-[30px] border border-cyan-300/30 bg-white/[0.08] p-6 shadow-[0_35px_100px_rgba(2,6,23,0.45),0_0_45px_rgba(6,182,212,0.16)] backdrop-blur-2xl sm:p-8" onSubmit={handleSubmit(onSubmit)}>
          <span className="ai-frame-corner left-0 top-0 rounded-tl-[30px] border-l-[5px] border-t-[5px]" />
          <span className="ai-frame-corner right-0 top-0 rounded-tr-[30px] border-r-[5px] border-t-[5px]" />
          <span className="ai-frame-corner bottom-0 right-0 rounded-br-[30px] border-b-[5px] border-r-[5px]" />
          <span className="ai-frame-corner bottom-0 left-0 rounded-bl-[30px] border-b-[5px] border-l-[5px]" />
          <span className="ai-scan-line" />

          <div className="relative z-10">
            <div className="mb-8 grid justify-items-center text-center">
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl border border-cyan-200/25 bg-cyan-400/10 text-cyan-100 shadow-[0_0_32px_rgba(34,211,238,0.3)]">
                <ScanFace size={34} />
              </div>
              <h1 className="m-0 text-3xl font-bold text-white sm:text-4xl">Smart Proctoring System</h1>
              <p className="mt-3 text-sm font-medium text-cyan-100/80">Through Audio and Visual Monitoring</p>
            </div>

            <div className="grid gap-5">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-200">School ID / Email</span>
                <div className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-cyan-200/20 bg-slate-950/55 px-4 text-slate-100 shadow-[inset_0_0_24px_rgba(15,23,42,0.6)] transition focus-within:border-cyan-300/70 focus-within:shadow-[0_0_26px_rgba(6,182,212,0.18)]">
                  <Mail className="text-cyan-200" size={20} />
                  <input className="w-full border-0 bg-transparent outline-none placeholder:text-slate-500" placeholder="student@university.edu" type="email" {...register("email", { required: "Email is required" })} />
                </div>
                {errors.email?.message ? <small className="text-sm font-semibold text-red-300">{errors.email.message}</small> : null}
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-slate-200">Password</span>
                <div className="flex min-h-[56px] items-center gap-3 rounded-2xl border border-cyan-200/20 bg-slate-950/55 px-4 text-slate-100 shadow-[inset_0_0_24px_rgba(15,23,42,0.6)] transition focus-within:border-cyan-300/70 focus-within:shadow-[0_0_26px_rgba(6,182,212,0.18)]">
                  <LockKeyhole className="text-cyan-200" size={20} />
                  <input className="w-full border-0 bg-transparent outline-none placeholder:text-slate-500" placeholder="Enter password" type={showPassword ? "text" : "password"} {...register("password", { required: "Password is required" })} />
                  <button className="grid h-9 w-9 place-items-center rounded-full text-slate-300 transition hover:bg-white/10 hover:text-cyan-100" onClick={() => setShowPassword((current) => !current)} type="button" aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password?.message ? <small className="text-sm font-semibold text-red-300">{errors.password.message}</small> : null}
              </label>
            </div>

            <div className="my-5 flex flex-wrap items-center justify-between gap-3 text-sm">
              <label className="inline-flex items-center gap-2 text-slate-300">
                <input className="h-4 w-4 rounded border-cyan-200/30 bg-slate-950 accent-cyan-400" type="checkbox" {...register("remember")} />
                Remember Me
              </label>
              <Link className="font-semibold text-cyan-200 transition hover:text-white" to="/forgot-password">Forgot Password?</Link>
            </div>

            <button className="ai-login-submit flex min-h-[58px] w-full items-center justify-center gap-3 rounded-full bg-gradient-to-r from-[#2563EB] to-[#06B6D4] px-6 text-base font-extrabold text-white shadow-[0_18px_42px_rgba(37,99,235,0.36)] transition hover:shadow-[0_0_36px_rgba(6,182,212,0.48)] disabled:cursor-not-allowed disabled:opacity-70" disabled={isSubmitting} type="submit">
              <ShieldCheck size={21} />
              {isSubmitting ? "Authenticating..." : "Login"}
            </button>

            <div className="mt-6 flex justify-center text-sm text-slate-400">
              <span>Need access? <Link className="font-semibold text-cyan-200 hover:text-white" to="/register">Create Account</Link></span>
            </div>
          </div>

          <Sparkles className="pointer-events-none absolute right-8 top-8 text-cyan-200/40" size={22} />
        </form>
      </section>
    </main>
  );
}
