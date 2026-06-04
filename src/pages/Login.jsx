import { useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button, Field } from "../components/ui";
import { useAuth } from "../context/AuthContext";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm({
    defaultValues: import.meta.env.DEV ? { email: "admin@university.edu", password: "123456" } : { email: "", password: "" },
  });

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
    <main className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit(onSubmit)}>
        <div className="auth-title">
          <h1>Smart Proctoring</h1>
          <p>Online Examination Monitoring System</p>
        </div>
        <Field label="Email Address" type="email" error={errors.email?.message} {...register("email", { required: "Email is required" })} />
        <Field label="Password" type="password" error={errors.password?.message} {...register("password", { required: "Password is required" })} />
        <Button disabled={isSubmitting}>{isSubmitting ? "Signing in..." : "Login"}</Button>
        <div className="auth-links">
          <Link to="/forgot-password">Forgot Password</Link>
          <Link to="/register">Create Account</Link>
        </div>
      </form>
    </main>
  );
}
