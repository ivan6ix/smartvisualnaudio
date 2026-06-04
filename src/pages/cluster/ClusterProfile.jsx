import { useState } from "react";
import { toast } from "sonner";
import { Button, Card, Field, PageHeader } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";
import { clusterProfile } from "../../data/clusterData";

export default function ClusterProfile() {
  const { logout, user } = useAuth();
  const [twoFactor, setTwoFactor] = useState(false);

  return (
    <>
      <PageHeader title="Profile" subtitle="Cluster Professor account details and security controls." />
      <div className="dashboard-grid">
        <Card>
          <h2>Account Information</h2>
          <div className="info-list">
            <span>Full name <strong>{user?.fullName || clusterProfile.fullName}</strong></span>
            <span>Email <strong>{user?.email || clusterProfile.email}</strong></span>
            <span>Role <strong>Cluster Professor</strong></span>
            <span>Account status <strong>{clusterProfile.accountStatus}</strong></span>
            <span>Date created <strong>{clusterProfile.createdAt}</strong></span>
          </div>
        </Card>
        <Card>
          <h2>Security and Privacy</h2>
          <form className="stack-form" onSubmit={(event) => { event.preventDefault(); toast.success("Password change request saved"); }}>
            <Field label="Change password" type="password" placeholder="New password" />
            <label className="cluster-toggle"><input type="checkbox" checked={twoFactor} onChange={(event) => setTwoFactor(event.target.checked)} /> Two-factor authentication</label>
            <Button>Save Security Settings</Button>
          </form>
        </Card>
      </div>
      <div className="dashboard-grid">
        <Card>
          <h2>Login History</h2>
          <div className="info-list">
            <span>May 31, 2026 09:12 <strong>Chrome on Windows</strong></span>
            <span>May 30, 2026 15:44 <strong>Edge on Windows</strong></span>
          </div>
        </Card>
        <Card>
          <h2>Device Sessions</h2>
          <div className="info-list">
            <span>Current session <strong>Active</strong></span>
            <span>Campus workstation <strong>Active</strong></span>
          </div>
          <Button variant="light" onClick={logout}>Logout</Button>
        </Card>
      </div>
    </>
  );
}
