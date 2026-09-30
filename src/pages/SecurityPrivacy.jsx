import { supabase, hasSupabaseConfig } from "../lib/supabase";
import { useForm } from "react-hook-form";
import { FiShield, FiUserCheck } from "react-icons/fi";
import { toast } from "sonner";
import ActiveSessions from "../components/ActiveSessions";
import LegalLinks from "../components/LegalLinks";
import PersonalActivityLogs from "../components/PersonalActivityLogs";
import { Button, Card, Field } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { writeAccountAuditLog } from "../lib/accountAudit";
import { changeAuthenticatedPassword, PASSWORD_MIN_LENGTH } from "../lib/settingsSecurity";

export default function SecurityPrivacy() {
  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm();
  const { user } = useAuth();

  async function changePassword(values) {
    if (hasSupabaseConfig) {
      const result = await changeAuthenticatedPassword({
        supabase,
        email: user?.email,
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
        confirmPassword: values.confirmPassword,
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      await writeAccountAuditLog({
        supabase,
        user,
        eventType: "account.password_changed",
        action: "Password Changed",
        description: "A user changed their account password.",
      });
    } else if (values.newPassword.length < PASSWORD_MIN_LENGTH || values.newPassword !== values.confirmPassword || !values.currentPassword) {
      toast.error(`Use at least ${PASSWORD_MIN_LENGTH} characters and matching passwords.`);
      return;
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
      <div className="dashboard-grid">
        <Card className="admin-panel settings-surface-card">
          <h2>Password & Authentication</h2>
          <p className="settings-readonly-note">Confirm your current password before choosing a new one.</p>
          <form className="stack-form" onSubmit={handleSubmit(changePassword)}>
            <Field autoComplete="current-password" label="Current Password" type="password" {...register("currentPassword", { required: true })} />
            <Field autoComplete="new-password" label="New Password" minLength={PASSWORD_MIN_LENGTH} type="password" {...register("newPassword", { required: true, minLength: PASSWORD_MIN_LENGTH })} />
            <Field autoComplete="new-password" label="Confirm New Password" minLength={PASSWORD_MIN_LENGTH} type="password" {...register("confirmPassword", { required: true, minLength: PASSWORD_MIN_LENGTH })} />
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
