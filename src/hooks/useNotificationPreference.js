import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
export default function useNotificationPreference() {
 const { user } = useAuth();
 const key = 'smartvisualnaudio.notification-preview.' + (user?.id || 'guest');
 const read = useCallback(() => { try { return window.localStorage.getItem(key) !== 'hidden'; } catch { return true; } }, [key]);
 const [showPreview, setShowPreview] = useState(read);
 useEffect(() => {
  const sync = () => setShowPreview(read());
  window.addEventListener('notification-preference', sync);
  window.addEventListener('storage', sync);
  return () => { window.removeEventListener('notification-preference', sync); window.removeEventListener('storage', sync); };
 }, [read]);
 function change(value) {
  setShowPreview(value);
  try { window.localStorage.setItem(key, value ? 'shown' : 'hidden'); } catch { return; }
  window.dispatchEvent(new window.Event('notification-preference'));
 }
 return [showPreview, change];
}
