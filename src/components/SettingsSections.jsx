import useNotificationPreference from "../hooks/useNotificationPreference";
import ThemeSettings from "./ThemeSettings";
import LegalLinks from "./LegalLinks";
import { useAuth } from "../context/AuthContext";
export default function SettingsSections() {
 const [showPreview, setShowPreview] = useNotificationPreference();
 const { logout } = useAuth();
 return <div className="settings-sections"><section className="card"><ThemeSettings /></section><section className="card"><h2>Notifications</h2><label><input type="checkbox" checked={showPreview} onChange={event => setShowPreview(event.target.checked)} /> Show notification message previews</label><p>Exam, review and account updates appear in the notification menu. Use Mark All as Read to clear unread updates.</p></section><section className="card"><h2>Privacy &amp; Security</h2><p>Use Security &amp; Privacy to change your password. Sign out when leaving a shared device.</p><button type="button" className="btn" onClick={logout}>Sign out</button><LegalLinks /></section></div>;
}
