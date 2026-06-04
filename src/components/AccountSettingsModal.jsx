import { useForm } from "react-hook-form";
import { FiX } from "react-icons/fi";
import { toast } from "sonner";
import { Button, Card, Field } from "./ui";
import { useAuth } from "../context/AuthContext";
import { hasSupabaseConfig, supabase } from "../lib/supabase";

export default function AccountSettingsModal({ mode, onClose }) {
  const { user } = useAuth();
  const { register, handleSubmit, reset, watch, formState: { isSubmitting } } = useForm();
  const isSecurity = mode === "security";
  const title = isSecurity ? "Security & Privacy" : "Profile Settings";

  async function updatePassword(values) {
    if (values.newPassword !== values.confirmPassword) {
      toast.error("New password and confirm password do not match");
      return;
    }

    if (hasSupabaseConfig) {
      const { error } = await supabase.auth.updateUser({ password: values.newPassword });
      if (error) {
        toast.error(error.message);
        return;
      }
    }

    toast.success("Password updated");
    reset();
  }

  return (
    <div className="settings-modal-backdrop" onClick={onClose} role="presentation">
      <section className="settings-modal" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="settings-modal-header">
          <div>
            <h2>{title}</h2>
            <p>{isSecurity ? "Manage password changes for your account." : "View your account profile information."}</p>
          </div>
          <button aria-label={`Close ${title}`} onClick={onClose} type="button"><FiX /></button>
        </div>

        {!isSecurity ? (
          <Card>
            <h2>Account Information</h2>
            <div className="info-list">
              <span>Full Name <strong>{user?.fullName || "-"}</strong></span>
              <span>Email <strong>{user?.email || "-"}</strong></span>
              <span>Role <strong>{user?.role || "-"}</strong></span>
            </div>
          </Card>
        ) : (
          <Card>
            <h2>Change Password</h2>
            <form className="stack-form" onSubmit={handleSubmit(updatePassword)}>
              <Field label="Current Password" type="password" {...register("currentPassword", { required: true })} />
              <Field label="New Password" type="password" {...register("newPassword", { required: true, minLength: 6 })} />
              <Field
                label="Confirm Password"
                type="password"
                {...register("confirmPassword", {
                  required: true,
                  validate: (value) => value === watch("newPassword"),
                })}
              />
              <Button disabled={isSubmitting}>{isSubmitting ? "Updating..." : "Update Password"}</Button>
            </form>
          </Card>
        )}
      </section>
    </div>
  );
}
