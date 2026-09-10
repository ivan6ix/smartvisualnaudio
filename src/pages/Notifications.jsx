import { Button, Card, PageHeader, Badge } from "../components/ui";
import { useAuth } from "../context/AuthContext";
import useAdminNotifications from "../hooks/useAdminNotifications";

export default function Notifications() {
  const { user } = useAuth();
  const { notifications, markAllRead } = useAdminNotifications(user);

  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Your account and examination notifications."
        actions={<Button variant="light" onClick={markAllRead}>Mark All as Read</Button>}
      />
      <Card>
        <div className="notification-list">
          {notifications.map((item) => (
            <article key={item.id}>
              <Badge tone={item.isRead ? "neutral" : "warn"}>{item.isRead ? "Read" : "Unread"}</Badge>
              <div>
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <small>{item.type}</small>
              </div>
            </article>
          ))}
          {!notifications.length ? <div className="empty-state">No notifications yet.</div> : null}
        </div>
      </Card>
    </>
  );
}
