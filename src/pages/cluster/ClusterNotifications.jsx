import { Button, Card, PageHeader } from "../../components/ui";
import { useCluster } from "../../context/ClusterContext";

export default function ClusterNotifications() {
  const { notifications, markNotification, markAllNotifications, deleteNotification } = useCluster();

  return (
    <>
      <PageHeader title="Notifications" subtitle="Exam submissions, approvals, rejections, resubmissions, and messages." actions={<Button variant="light" onClick={markAllNotifications}>Mark all as read</Button>} />
      <Card>
        <div className="notification-list">
          {notifications.map((item) => (
            <article key={item.id}>
              <div className={item.isRead ? "cluster-dot read" : "cluster-dot"} />
              <div>
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <small>{item.type} - {item.createdAt}</small>
              </div>
              <div className="header-actions">
                <Button variant="light" onClick={() => markNotification(item.id)}>Mark as read</Button>
                <Button variant="light" onClick={() => deleteNotification(item.id)}>Delete</Button>
              </div>
            </article>
          ))}
        </div>
      </Card>
    </>
  );
}
