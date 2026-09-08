import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { Activity, AlertTriangle, AudioWaveform, BrainCircuit, Camera, Eye, EyeOff, LockKeyhole, Mail, Radar, ScanFace, ShieldCheck, Sparkles } from "lucide-react";
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
  const [lookState, setLookState] = useState({ x: 0, y: 0, direction: "center" });
  const [temporaryViolation, setTemporaryViolation] = useState("");
  const previewRef = useRef(null);
  const pointerFrameRef = useRef(0);
  const violationTimerRef = useRef(0);
  const temporaryViolationRef = useRef("");
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues: { email: "", password: "", remember: false } });

  useEffect(() => {
    if (searchParams.get("confirmed") === "1") {
      toast.success("Email confirmed. You can now log in.");
    }
  }, [searchParams]);

  useEffect(() => {
    function setTemporaryDemoViolation(message, persistUntilVisible = false) {
      if (temporaryViolationRef.current !== message) {
        temporaryViolationRef.current = message;
        setTemporaryViolation(message);
      }
      window.clearTimeout(violationTimerRef.current);
      if (!persistUntilVisible) {
        violationTimerRef.current = window.setTimeout(() => {
          temporaryViolationRef.current = "";
          setTemporaryViolation("");
        }, 2600);
      }
    }

    function handleCopy() {
      setTemporaryDemoViolation("Copy Attempt Detected");
    }

    function handlePageLeave() {
      setTemporaryDemoViolation("Cursor Left Page Detected");
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        setTemporaryDemoViolation("Tab Switch Detected", true);
      } else if (temporaryViolationRef.current === "Tab Switch Detected") {
        setTemporaryDemoViolation("Tab Switch Detected");
      }
    }

    document.addEventListener("copy", handleCopy);
    document.documentElement.addEventListener("mouseleave", handlePageLeave);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.cancelAnimationFrame(pointerFrameRef.current);
      window.clearTimeout(violationTimerRef.current);
      document.removeEventListener("copy", handleCopy);
      document.documentElement.removeEventListener("mouseleave", handlePageLeave);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  function handlePointerMove(event) {
    const preview = previewRef.current;
    if (!preview) return;
    const { left, top, width, height } = preview.getBoundingClientRect();
    const x = Math.max(-1, Math.min(1, (event.clientX - (left + width / 2)) / (width / 2)));
    const y = Math.max(-1, Math.min(1, (event.clientY - (top + height / 2)) / (height / 2)));

    window.cancelAnimationFrame(pointerFrameRef.current);
    pointerFrameRef.current = window.requestAnimationFrame(() => {
      const deadZone = 0.3;
      let direction = "center";
      if (Math.max(Math.abs(x), Math.abs(y)) > deadZone) {
        direction = Math.abs(x) >= Math.abs(y) ? (x < 0 ? "left" : "right") : (y < 0 ? "up" : "down");
      }
      setLookState({ x, y, direction });
    });
  }

  const directionViolation = lookState.direction === "center"
    ? null
    : `Looking ${lookState.direction[0].toUpperCase()}${lookState.direction.slice(1)} Detected`;
  const demoViolation = temporaryViolation || directionViolation;
  const headTransform = `translate(calc(-50% + ${lookState.x * 3}px), ${lookState.y * 2}px)`;
  const eyeTransform = `translate(${lookState.x * 4}px, ${lookState.y * 3}px)`;

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
    <main className="ai-login-page relative min-h-screen overflow-hidden bg-canvas px-4 py-8 text-primary sm:px-6 lg:px-10" onPointerMove={handlePointerMove}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(6,182,212,0.22),transparent_28%),radial-gradient(circle_at_82%_28%,rgba(37,99,235,0.26),transparent_30%),linear-gradient(135deg,var(--app-bg),var(--app-bg-secondary))]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(148,163,184,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.05)_1px,transparent_1px)] bg-[size:44px_44px]" />

      {particles.map((particle) => (
        <span
          className="ai-login-particle absolute rounded-full bg-cyan-300/70 shadow-[0_0_18px_rgba(34,211,238,0.75)]"
          key={particle.id}
          style={{ left: particle.left, top: particle.top, width: particle.size, height: particle.size, animationDelay: particle.delay }}
        />
      ))}

      {floatingIcons.map(({ Icon, className }, index) => (
        <div className={`ai-floating-icon pointer-events-none absolute hidden rounded-2xl border border-cyan-300/20 bg-white/5 p-3 text-accent shadow-[0_0_32px_rgba(6,182,212,0.2)] backdrop-blur-md lg:block ${className}`} key={index}>
          <Icon size={22} />
        </div>
      ))}

      <section className="relative z-10 mx-auto grid min-h-[calc(100vh-4rem)] w-full max-w-7xl items-center gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.85fr)]">
        <div className="glass-panel relative overflow-hidden rounded-[28px] border border-cyan-300/20 bg-surface p-5 shadow-[0_30px_90px_rgba(2,6,23,0.38)] backdrop-blur-2xl sm:p-7 lg:p-8">
          <div className="mb-7 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-400/15 text-accent shadow-[0_0_30px_rgba(6,182,212,0.25)]">
                <Radar size={25} />
              </div>
              <div>
                <p className="ai-login-primary m-0 text-sm font-semibold">AI Proctoring Console</p>
                <span className="ai-login-secondary text-xs font-medium">Live exam integrity view</span>
              </div>
            </div>
            <div className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-xs font-bold text-emerald-200">ACTIVE</div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_220px]">
            <div className="relative min-h-[380px] overflow-hidden rounded-3xl border border-line bg-control shadow-[inset_0_0_40px_rgba(15,23,42,0.95)]" ref={previewRef}>
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(14,165,233,0.2),transparent_32%),linear-gradient(180deg,var(--app-bg-secondary),var(--app-bg-secondary))]" />
              <div className="absolute left-5 top-5 flex items-center gap-2 rounded-full border border-red-300/30 bg-red-500/10 px-3 py-1 text-xs font-bold text-red-200">
                <span className="h-2 w-2 rounded-full bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.9)]" />
                REC
              </div>
              <div className="absolute right-5 top-5 flex items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-400/10 px-3 py-1 text-xs font-semibold text-accent">
                <Camera size={14} />
                Webcam 01
              </div>

              <div className="absolute inset-x-8 bottom-0 top-20 flex items-end justify-center">
                <div className="relative h-[285px] w-[235px]">
                  <div className="ai-avatar-head absolute left-1/2 top-2 h-28 w-28 rounded-full border border-cyan-200/20 bg-[linear-gradient(145deg,#dbeafe,#94a3b8)] shadow-[0_0_40px_rgba(6,182,212,0.18)]" style={{ transform: headTransform }}>
                    <div className="absolute left-0 right-0 top-[52px] flex justify-center gap-8">
                      <span className="ai-avatar-eye h-2 w-2 rounded-full bg-slate-900" style={{ transform: eyeTransform }} />
                      <span className="ai-avatar-eye h-2 w-2 rounded-full bg-slate-900" style={{ transform: eyeTransform }} />
                    </div>
                    <span className="absolute left-1/2 top-[76px] h-1 w-8 -translate-x-1/2 rounded-full bg-slate-500" />
                  </div>
                  <div className="absolute left-1/2 top-32 h-40 w-48 -translate-x-1/2 rounded-t-[70px] bg-[linear-gradient(145deg,#1e293b,#475569)]" />
                  <div className="ai-face-frame absolute left-1/2 top-5 h-28 w-32 -translate-x-1/2 rounded-2xl shadow-[0_0_28px_rgba(34,211,238,0.55)]">
                    <span className="absolute -left-2 -top-2 h-7 w-7 rounded-tl-xl border-l-[5px] border-t-[5px] border-blue-400" />
                    <span className="absolute -right-2 -top-2 h-7 w-7 rounded-tr-xl border-r-[5px] border-t-[5px] border-blue-400" />
                    <span className="absolute -bottom-2 -right-2 h-7 w-7 rounded-br-xl border-b-[5px] border-r-[5px] border-blue-400" />
                    <span className="absolute -bottom-2 -left-2 h-7 w-7 rounded-bl-xl border-b-[5px] border-l-[5px] border-blue-400" />
                  </div>
                </div>
              </div>

              <div className="absolute bottom-5 left-5 right-5 grid gap-3 rounded-2xl border border-line bg-control p-4 backdrop-blur-md">
                <div className="flex items-center justify-between text-xs text-primary">
                  <span>Face confidence</span>
                  <strong className="text-accent">98.7%</strong>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <span className="block h-full w-[91%] rounded-full bg-gradient-to-r from-blue-500 to-cyan-400" />
                </div>
              </div>
            </div>

            <div className="grid gap-4">
              <div className="rounded-3xl border border-line bg-control p-4 backdrop-blur">
                <div className="ai-login-primary mb-4 flex items-center gap-2 text-sm font-semibold"><Activity size={17} /> Audio Waveform</div>
                <div className="flex h-24 items-end gap-2">
                  {[34, 64, 42, 82, 54, 92, 46, 72, 38, 68, 50, 88].map((height, index) => (
                    <span className="ai-wave-bar flex-1 rounded-full bg-gradient-to-t from-blue-600 to-cyan-300" key={index} style={{ height: `${height}%`, animationDelay: `${index * 0.08}s` }} />
                  ))}
                </div>
              </div>
              <div className="rounded-3xl border border-line bg-control p-4 backdrop-blur">
                <div className="ai-login-primary mb-4 flex items-center gap-2 text-sm font-semibold"><AlertTriangle size={17} /> Violations</div>
                <div aria-live="polite" className={`ai-demo-violation ${demoViolation ? "active" : "clear"}`}>
                  <span aria-hidden="true" />
                  <strong>{demoViolation || "No violations detected"}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>

        <form className="ai-login-frame relative overflow-hidden rounded-[30px] border border-cyan-300/30 bg-surface p-6 shadow-[0_35px_100px_rgba(2,6,23,0.45),0_0_45px_rgba(6,182,212,0.16)] backdrop-blur-2xl sm:p-8" onSubmit={handleSubmit(onSubmit)}>
          <span className="ai-frame-corner left-0 top-0 rounded-tl-[30px] border-l-[5px] border-t-[5px]" />
          <span className="ai-frame-corner right-0 top-0 rounded-tr-[30px] border-r-[5px] border-t-[5px]" />
          <span className="ai-frame-corner bottom-0 right-0 rounded-br-[30px] border-b-[5px] border-r-[5px]" />
          <span className="ai-frame-corner bottom-0 left-0 rounded-bl-[30px] border-b-[5px] border-l-[5px]" />
          <span className="ai-scan-line" />

          <div className="relative z-10">
            <div className="mb-8 grid justify-items-center text-center">
              <div className="mb-4 grid h-16 w-16 place-items-center rounded-3xl border border-cyan-200/25 bg-cyan-400/10 text-accent shadow-[0_0_32px_rgba(34,211,238,0.3)]">
                <ScanFace size={34} />
              </div>
              <h1 className="ai-login-primary m-0 text-3xl font-bold sm:text-4xl">Smart Proctoring System</h1>
              <p className="ai-login-secondary mt-3 text-sm font-medium">Through Audio and Visual Monitoring</p>
            </div>

            <div className="grid gap-5">
              <label className="grid gap-2">
                <span className="ai-login-primary text-sm font-semibold">School ID / Email</span>
                <div className="ai-login-control flex min-h-[56px] items-center gap-3 rounded-2xl px-4 shadow-[inset_0_0_24px_rgba(15,23,42,0.6)] transition">
                  <Mail className="text-accent" size={20} />
                  <input className="w-full border-0 bg-transparent outline-none placeholder:text-secondary" placeholder="student@university.edu" type="email" {...register("email", { required: "Email is required" })} />
                </div>
                {errors.email?.message ? <small className="text-sm font-semibold text-red-300">{errors.email.message}</small> : null}
              </label>

              <label className="grid gap-2">
                <span className="ai-login-primary text-sm font-semibold">Password</span>
                <div className="ai-login-control flex min-h-[56px] items-center gap-3 rounded-2xl px-4 shadow-[inset_0_0_24px_rgba(15,23,42,0.6)] transition">
                  <LockKeyhole className="text-accent" size={20} />
                  <input className="w-full border-0 bg-transparent outline-none placeholder:text-secondary" placeholder="Enter password" type={showPassword ? "text" : "password"} {...register("password", { required: "Password is required" })} />
                  <button className="grid h-9 w-9 place-items-center rounded-full text-primary transition hover:bg-white/10 hover:text-accent" onClick={() => setShowPassword((current) => !current)} type="button" aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {errors.password?.message ? <small className="text-sm font-semibold text-red-300">{errors.password.message}</small> : null}
              </label>
            </div>

            <div className="my-5 flex flex-wrap items-center justify-between gap-3 text-sm">
              <label className="ai-login-secondary inline-flex items-center gap-2">
                <input className="h-4 w-4 rounded border-cyan-200/30 bg-control accent-cyan-400" type="checkbox" {...register("remember")} />
                Remember Me
              </label>
              <Link className="font-semibold text-accent transition hover:text-primary" to="/forgot-password">Forgot Password?</Link>
            </div>

            <button className="ai-login-submit flex min-h-[58px] w-full items-center justify-center gap-3 rounded-full bg-gradient-to-r from-[#2563EB] to-[#06B6D4] px-6 text-base font-extrabold text-white shadow-[0_18px_42px_rgba(37,99,235,0.36)] transition hover:shadow-[0_0_36px_rgba(6,182,212,0.48)] disabled:cursor-not-allowed disabled:opacity-70" disabled={isSubmitting} type="submit">
              <ShieldCheck size={21} />
              {isSubmitting ? "Authenticating..." : "Login"}
            </button>

            <div className="mt-6 flex justify-center text-sm text-secondary">
              <span>Need access? <Link className="font-semibold text-accent hover:text-primary" to="/register">Create Account</Link></span>
            </div>
          </div>

          <Sparkles className="pointer-events-none absolute right-8 top-8 text-accent/40" size={22} />
        </form>
      </section>
    </main>
  );
}
