import { supabase, hasSupabaseConfig } from "../lib/supabase";
import { useForm } from "react-hook-form";
import { FiShield, FiUserCheck } from "react-icons/fi";
import { toast } from "sonner";
import ActiveSessions from "../components/ActiveSessions";
import LegalLinks from "../components/LegalLinks";
import PersonalActivityLogs from "../components/PersonalActivityLogs";
import { Button, Card, Field, PageHeader } from "../components/ui";

export default function SecurityPrivacy() {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm();

  async function changePassword(values) {
    if (values.newPassword.length < 6 || values.newPassword !== values.confirmPassword) { toast.error("Use at least 6 characters and matching passwords."); return; }
    if (hasSupabaseConfig) {
      const { error } = await supabase.auth.updateUser({ password: values.newPassword });
      if (error) { toast.error(error.message); return; }
    }
    toast.success("Password updated");
    reset();
  }

  return (
    <section className="admin-dashboard-page admin-section-page security-privacy-page">
      <div className="admin-section-hero">
        <div>
          <span><FiShield /> Account Security Console</span>
          <h1>Security & Privacy</h1>
          <p>Manage password protection, session awareness, and privacy information for your account.</p>
        </div>
        <strong><FiUserCheck /></strong>
      </div>
      <PageHeader title="Security & Privacy" subtitle="Manage authentication, active session details, and privacy resources." />
      <div className="dashboard-grid">
        <Card className="admin-panel settings-surface-card">
          <h2>Password & Authentication</h2>
          <form className="stack-form" onSubmit={handleSubmit(changePassword)}>
            <Field label="Current Password" type="password" {...register("currentPassword", { required: true })} />
            <Field label="New Password" type="password" {...register("newPassword", { required: true })} />
            <Field label="Confirm Password" type="password" {...register("confirmPassword", { required: true })} />
            <Button disabled={isSubmitting}>{isSubmitting ? "Updating..." : "Update Password"}</Button>
          </form>
        </Card>
        <Card className="admin-panel settings-surface-card">
          <ActiveSessions />
        </Card>
      </div>
      <div className="dashboard-grid">
        <Card className="admin-panel settings-surface-card">
          <h2>Session Security</h2>
          <p>Session expiration and authentication state are managed by the configured Supabase Auth session.</p>
        </Card>
        <Card className="admin-panel settings-surface-card">
          <h2>Privacy</h2>
          <p>Review the system policies and local browser storage information.</p>
          <LegalLinks />
        </Card>
      </div>
      <Card className="admin-panel admin-activity-panel settings-surface-card">
        <h2>Activity Logs</h2>
        <PersonalActivityLogs />
      </Card>
    </section>
  );
}
