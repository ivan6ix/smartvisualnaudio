import NotificationHistory from "../components/NotificationHistory";
import { PageHeader } from "../components/ui";
import { useAuth } from "../context/AuthContext";

export default function Notifications() {
  const { user } = useAuth();

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Your account and examination notifications."
      />
      <NotificationHistory user={user} />
    </>
  );
}
