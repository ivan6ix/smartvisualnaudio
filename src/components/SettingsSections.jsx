import useNotificationPreference from "../hooks/useNotificationPreference";
import ThemeSettings from "./ThemeSettings";
export default function SettingsSections() {
 const [showPreview, setShowPreview, preferenceState] = useNotificationPreference();
 return <div className="settings-sections"><section className="card"><ThemeSettings /></section><section className="card"><h2>Notifications</h2><div className="notification-toggle-row"><div><strong>Show notification message previews</strong><p>Exam, review and account updates appear in the notification menu. Use Mark All as Read to clear unread updates.</p>{preferenceState.loading || preferenceState.saving ? <small>{preferenceState.loading ? "Loading preference..." : "Saving..."}</small> : null}</div><button aria-checked={showPreview} className={`settings-switch ${showPreview ? "on" : ""}`} disabled={preferenceState.saving} onClick={() => setShowPreview(!showPreview)} role="switch" type="button"><span>{showPreview ? "ON" : "OFF"}</span><i /></button></div></section></div>;
}
