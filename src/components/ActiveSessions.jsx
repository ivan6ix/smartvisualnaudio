import { useCallback, useEffect, useMemo, useState } from "react";
import { FiRefreshCw } from "react-icons/fi";
import { toast } from "sonner";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { Button } from "./ui";

function getBrowser(userAgent) {
  if (/Edg\//.test(userAgent)) return "Edge";
  if (/OPR\//.test(userAgent)) return "Opera";
  if (/Chrome\//.test(userAgent) && !/Chromium\//.test(userAgent)) return "Chrome";
  if (/Firefox\//.test(userAgent)) return "Firefox";
  if (/Safari\//.test(userAgent) && !/Chrome\//.test(userAgent)) return "Safari";
  return "Browser";
}

function getOperatingSystem(userAgent) {
  if (/Windows NT/.test(userAgent)) return "Windows PC";
  if (/Android/.test(userAgent)) return "Android";
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Mac OS X/.test(userAgent)) return "Mac";
  if (/Linux/.test(userAgent)) return "Linux";
  return "This device";
}

function formatDate(value) {
  if (!value) return "Unavailable";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export default function ActiveSessions() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loggingOutOthers, setLoggingOutOthers] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const device = useMemo(() => {
    const userAgent = window.navigator.userAgent || "";
    return {
      browser: getBrowser(userAgent),
      os: getOperatingSystem(userAgent),
    };
  }, []);

  const loadSession = useCallback(async () => {
    setLoading(true);
    try {
      if (!hasSupabaseConfig) {
        setSession({ expires_at: null, user: null });
        return;
      }

      const { data, error } = await supabase.auth.getSession();
      if (error) throw error;
      setSession(data.session || null);
    } catch (error) {
      toast.error(error.message || "Unable to refresh active sessions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  async function logoutOtherSessions() {
    setLoggingOutOthers(true);
    try {
      if (!hasSupabaseConfig) {
        toast.info("Other session logout requires Supabase Auth.");
        return;
      }

      const { error } = await supabase.auth.signOut({ scope: "others" });
      if (error) throw error;
      toast.success("Other sessions have been logged out");
      setConfirmOpen(false);
      await loadSession();
    } catch (error) {
      toast.error(error.message || "Unable to log out other sessions");
    } finally {
      setLoggingOutOthers(false);
    }
  }

  return (
    <>
      <CardlessSessionPanel
        device={device}
        loading={loading}
        onRefresh={loadSession}
        onRequestLogoutOthers={() => setConfirmOpen(true)}
        session={session}
      />
      {confirmOpen ? (
        <div className="session-confirm-backdrop" onClick={() => setConfirmOpen(false)} role="presentation">
          <section aria-modal="true" className="session-confirm-modal" onClick={(event) => event.stopPropagation()} role="dialog">
            <h2>Log out all other sessions?</h2>
            <p>You will remain signed in on this device, but your other sessions will be signed out.</p>
            <div className="session-confirm-actions">
              <Button disabled={loggingOutOthers} onClick={() => setConfirmOpen(false)} type="button" variant="light">Cancel</Button>
              <Button disabled={loggingOutOthers} onClick={logoutOtherSessions} type="button">
                {loggingOutOthers ? "Logging out..." : "Log Out Other Sessions"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}

function CardlessSessionPanel({ device, loading, onRefresh, onRequestLogoutOthers, session }) {
  return (
    <div className="active-sessions-panel">
      <div className="active-sessions-heading">
        <div>
          <h2>Active Sessions</h2>
          <p>Review the devices and sessions currently signed in to your account.</p>
        </div>
        <button disabled={loading} onClick={onRefresh} type="button">
          <FiRefreshCw /> {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      <article className="active-session-item">
        <div>
          <strong>{device.os} · {device.browser}</strong>
          <span>Last active: Just now</span>
          <span>Expires: {formatDate(session?.expires_at)}</span>
        </div>
        <span className="session-current-badge">Current Session</span>
      </article>
      <p className="active-session-note">No other active sessions are available from the browser client. Supabase Auth can log out other sessions, but does not expose a safe frontend list of every logged-in device.</p>
      <div className="active-session-actions">
        <Button disabled={loading || !hasSupabaseConfig} onClick={onRequestLogoutOthers} type="button" variant="light">
          Log Out All Other Sessions
        </Button>
      </div>
    </div>
  );
}
