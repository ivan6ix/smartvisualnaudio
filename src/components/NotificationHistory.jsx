import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Badge, Card, EmptyState } from "./ui";
import NotificationPreview from "./NotificationPreview";
import useNotifications from "../hooks/useNotifications";

function formatNotificationDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function NotificationHistory({ user }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const {
    historyNotifications,
    historyPageCount,
    historyTotal,
    historyLoading,
    unreadCount,
    markNotificationRead,
    markAllRead,
  } = useNotifications(user, { page, includeHistory: true });

  async function openNotification(notification) {
    const marked = notification.isRead ? true : await markNotificationRead(notification.id);
    if (marked && notification.actionPath) navigate(notification.actionPath);
  }

  return (
    <Card>
      <div className="notification-history-toolbar">
        <span>{historyTotal} notification{historyTotal === 1 ? "" : "s"}</span>
        {unreadCount ? <Button variant="light" onClick={markAllRead}>Mark all as read</Button> : null}
      </div>
      <div className="notification-history-list">
        {historyNotifications.map((item) => (
          <article className={item.isRead ? "read" : "unread"} key={item.id}>
            <Badge tone={item.isRead ? "neutral" : "warn"}>{item.isRead ? "Read" : "Unread"}</Badge>
            <button className="notification-history-main" onClick={() => openNotification(item)} type="button">
              <strong>{item.title}</strong>
              <NotificationPreview>{item.message}</NotificationPreview>
              <small>{item.typeLabel} - {formatNotificationDate(item.createdAt)}</small>
            </button>
            {!item.isRead ? <Button variant="light" onClick={() => markNotificationRead(item.id)}>Mark read</Button> : null}
          </article>
        ))}
        {!historyNotifications.length && !historyLoading ? <EmptyState title="No notifications yet" description="New account and examination updates will appear here." /> : null}
        {historyLoading ? <div className="empty-state">Loading notifications...</div> : null}
      </div>
      <div className="notification-pagination">
        <Button variant="light" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>Previous</Button>
        <span>Page {page} of {historyPageCount}</span>
        <Button variant="light" disabled={page >= historyPageCount} onClick={() => setPage((current) => Math.min(historyPageCount, current + 1))}>Next</Button>
      </div>
    </Card>
  );
}
