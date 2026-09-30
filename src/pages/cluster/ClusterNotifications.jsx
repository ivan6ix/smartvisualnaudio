import NotificationHistory from "../../components/NotificationHistory";
import { PageHeader } from "../../components/ui";
import { useAuth } from "../../context/AuthContext";

export default function ClusterNotifications() {
  const { user } = useAuth();

  return (
    <>
      <PageHeader title="Notifications" subtitle="Exam submissions, approvals, rejections, resubmissions, and account updates." />
      <NotificationHistory user={user} />
    </>
  );
}
