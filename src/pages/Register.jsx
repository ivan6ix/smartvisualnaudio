import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button, Field } from "../components/ui";
import { useAuth } from "../context/AuthContext";

export default function Register() {
  const { register: createStudent } = useAuth();
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm();

  async function onSubmit(values) {
    if (values.password !== values.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    try {
      await createStudent(values);
      reset();
    } catch (error) {
      toast.error(error.message);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card wide" onSubmit={handleSubmit(onSubmit)}>
        <div className="auth-title">
          <h1>Student Registration</h1>
          <p>Use your personal email. A confirmation link will be sent before you can log in.</p>
        </div>
        <div className="stack-form">
          <Field label="Full Name" error={errors.fullName?.message} {...register("fullName", { required: "Full name is required" })} />
          <Field label="Student Number" error={errors.studentNumber?.message} {...register("studentNumber", { required: "Student number is required" })} />
          <Field label="Email" type="email" error={errors.email?.message} {...register("email", { required: "Email is required" })} />
          <Field label="Password" type="password" error={errors.password?.message} {...register("password", { required: "Password is required", minLength: { value: 6, message: "Password must be at least 6 characters" } })} />
          <Field label="Confirm Password" type="password" error={watch("password") !== watch("confirmPassword") ? "Passwords must match" : errors.confirmPassword?.message} {...register("confirmPassword", { required: "Confirm password is required" })} />
        </div>
        <Button disabled={isSubmitting}>{isSubmitting ? "Creating Account..." : "Create Student Account"}</Button>
        <div className="auth-links"><Link to="/login">Back to Login</Link></div>
      </form>
    </main>
  );
}
