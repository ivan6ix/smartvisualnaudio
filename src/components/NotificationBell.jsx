import { useEffect, useMemo, useRef, useState } from "react";
import { FiBell } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import useNotifications from "../hooks/useNotifications";
import NotificationPreview from "./NotificationPreview";
import { NOTIFICATION_DROPDOWN_LIMIT } from "../lib/notifications";

function formatNotificationTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function notificationHistoryPath(role) {
  if (role === "Professor") return "/professor/notifications";
  if (role === "Student") return "/student/notifications";
  if (role === "Dean") return "/dean/notifications";
  if (role === "Cluster Professor") return "/cluster/notifications";
  return "/notifications";
}

export default function NotificationBell({ user, emptyText = "No live notifications yet." }) {
  const navigate = useNavigate();
  const menuRef = useRef(null);
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markAllRead, markNotificationRead } = useNotifications(user);
  const visibleNotifications = useMemo(() => notifications.slice(0, NOTIFICATION_DROPDOWN_LIMIT), [notifications]);

  useEffect(() => {
    if (!open) return undefined;
    function handlePointer(event) {
      if (menuRef.current && !menuRef.current.contains(event.target)) setOpen(false);
    }
    function handleKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  async function openNotification(notification) {
    const marked = notification.isRead ? true : await markNotificationRead(notification.id);
    if (marked && notification.actionPath) navigate(notification.actionPath);
    setOpen(false);
  }

  return (
    <div className={`notification-menu ${open ? "open" : ""}`} ref={menuRef}>
      <button aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((current) => !current)} title="Notifications" type="button">
        <FiBell />{unreadCount ? <span>{unreadCount}</span> : null}
      </button>
      <div className="notification-menu-panel" role="menu">
        <header>
          <strong>Notifications</strong>
          <span>
            {unreadCount ? <button type="button" onClick={markAllRead}>Mark all as read</button> : null}
            <button type="button" onClick={() => { navigate(notificationHistoryPath(user?.role)); setOpen(false); }}>View all</button>
          </span>
        </header>
        {visibleNotifications.map((notification) => (
          <article className={notification.isRead ? "read" : "unread"} key={notification.id}>
            <button className="notification-item-main" onClick={() => openNotification(notification)} type="button">
              <div>
                <b>{notification.title}</b>
                <small>{notification.typeLabel}</small>
              </div>
              <NotificationPreview>{notification.message}</NotificationPreview>
              <time>{formatNotificationTime(notification.createdAt)}</time>
            </button>
            {!notification.isRead ? <button className="notification-read-action" onClick={() => markNotificationRead(notification.id)} type="button">Mark read</button> : null}
            {!notification.isRead ? <i aria-label="Unread notification" /> : null}
          </article>
        ))}
        {!visibleNotifications.length ? <p className="message-menu-empty">{emptyText}</p> : null}
      </div>
    </div>
  );
}
