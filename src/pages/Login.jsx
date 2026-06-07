import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { FiVolume2 } from "react-icons/fi";
import { toast } from "sonner";
import { Button, Field } from "../components/ui";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({ defaultValues: { email: "", password: "" } });

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
    <main className="auth-page login-page">
      <form className="auth-card login-tracker-card" onSubmit={handleSubmit(onSubmit)}>
        <span className="login-corner login-corner-top-left" />
        <span className="login-corner login-corner-top-right" />
        <span className="login-corner login-corner-bottom-left" />
        <span className="login-corner login-corner-bottom-right" />

        <div className="login-rec-badge" aria-label="Recording indicator">
          <span />
          <strong>REC</strong>
        </div>

        <div className="login-volume-meter" aria-label="Volume meter">
          <FiVolume2 />
          <div>
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>

        <div className="auth-title login-title">
          <h1>Smart<br />Proctoring</h1>
        </div>

        <div className="login-fields">
          <Field className="login-field" label="Email" type="email" error={errors.email?.message} {...register("email", { required: "Email is required" })} />
          <Field className="login-field" label="Password" type="password" error={errors.password?.message} {...register("password", { required: "Password is required" })} />
        </div>

        <Button className="login-button" disabled={isSubmitting}>{isSubmitting ? "Signing in..." : "Login"}</Button>

        <div className="auth-links login-links">
          <Link to="/forgot-password">Forgot Password</Link>
          <Link to="/register">Create Account</Link>
        </div>
      </form>
    </main>
  );
}
