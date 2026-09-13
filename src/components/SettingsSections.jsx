import useNotificationPreference from "../hooks/useNotificationPreference";
import ThemeSettings from "./ThemeSettings";
export default function SettingsSections() {
 const [showPreview, setShowPreview] = useNotificationPreference();
 return <div className="settings-sections"><section className="card"><ThemeSettings /></section><section className="card"><h2>Notifications</h2><div className="notification-toggle-row"><div><strong>Show notification message previews</strong><p>Exam, review and account updates appear in the notification menu. Use Mark All as Read to clear unread updates.</p></div><button aria-checked={showPreview} className={`settings-switch ${showPreview ? "on" : ""}`} onClick={() => setShowPreview(!showPreview)} role="switch" type="button"><span>{showPreview ? "ON" : "OFF"}</span><i /></button></div></section></div>;
}
