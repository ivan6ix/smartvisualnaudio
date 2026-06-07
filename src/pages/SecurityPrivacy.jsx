import { useForm } from "react-hook-form";
import { FiShield, FiUserCheck } from "react-icons/fi";
import { toast } from "sonner";
import { Button, Card, Field, PageHeader, Table } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import { logs } from "../data/mockData";

export default function SecurityPrivacy() {
  const { user } = useAuth();
  const { register, handleSubmit, reset } = useForm();

  function changePassword() {
    toast.success("Password change request submitted");
    reset();
  }

  return (
    <section className="admin-dashboard-page admin-section-page security-privacy-page">
      <div className="admin-section-hero">
        <div>
          <span><FiShield /> Account Security Console</span>
          <h1>Security & Privacy</h1>
          <p>Manage profile identity, password protection, and recent account activity with a readable secure settings layout.</p>
        </div>
        <strong><FiUserCheck /></strong>
      </div>
      <PageHeader title="Security & Privacy" subtitle="Manage account information, password changes, and activity logs." />
      <div className="dashboard-grid">
        <Card className="admin-panel settings-surface-card">
          <h2>Account Information</h2>
          <div className="info-list">
            <span>Full Name <strong>{user?.fullName}</strong></span>
            <span>Email <strong>{user?.email}</strong></span>
            <span>Role <strong>{user?.role}</strong></span>
          </div>
        </Card>
        <Card className="admin-panel settings-surface-card">
          <h2>Change Password</h2>
          <form className="stack-form" onSubmit={handleSubmit(changePassword)}>
            <Field label="Current Password" type="password" {...register("currentPassword", { required: true })} />
            <Field label="New Password" type="password" {...register("newPassword", { required: true })} />
            <Field label="Confirm Password" type="password" {...register("confirmPassword", { required: true })} />
            <Button>Update Password</Button>
          </form>
        </Card>
      </div>
      <Card className="admin-panel admin-activity-panel settings-surface-card">
        <h2>Activity Logs</h2>
        <Table columns={[{ key: "action", label: "Action" }, { key: "description", label: "Description" }, { key: "createdAt", label: "Date" }]} rows={logs.filter((log) => ["Login", "Logout", "Password Change"].includes(log.action))} />
      </Card>
    </section>
  );
}
