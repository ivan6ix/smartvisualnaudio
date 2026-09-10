import useNotificationPreference from "../hooks/useNotificationPreference";
export default function NotificationPreview({ children }) { const [showPreview] = useNotificationPreference(); return <p>{showPreview ? children : "Notification preview hidden"}</p>; }
