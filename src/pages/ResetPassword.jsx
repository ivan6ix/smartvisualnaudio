import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button, Field } from "../components/ui";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

export default function ResetPassword() {
  const navigate = useNavigate();
  const [values, setValues] = useState({ password: "", confirmPassword: "" });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (values.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    if (values.password !== values.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }

    setSaving(true);
    try {
      if (hasSupabaseConfig) {
        const { error } = await supabase.auth.updateUser({ password: values.password });
        if (error) throw error;
        await supabase.auth.signOut();
      }
      toast.success("Password updated. Please log in with your new password.");
      navigate("/login");
    } catch (error) {
      toast.error(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <div className="auth-title">
          <h1>Reset Password</h1>
          <p>Create a new password for your account.</p>
        </div>
        <Field
          label="New Password"
          minLength={6}
          onChange={(event) => setValues({ ...values, password: event.target.value })}
          required
          type="password"
          value={values.password}
        />
        <Field
          label="Confirm Password"
          onChange={(event) => setValues({ ...values, confirmPassword: event.target.value })}
          required
          type="password"
          value={values.confirmPassword}
        />
        <Button disabled={saving}>{saving ? "Updating..." : "Update Password"}</Button>
        <div className="auth-links"><Link to="/login">Back to Login</Link></div>
      </form>
    </main>
  );
}
