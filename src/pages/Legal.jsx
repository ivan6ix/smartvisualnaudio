import { Link, useLocation } from "react-router-dom";
import LegalLinks from "../components/LegalLinks";
const pages = {
  '/privacy': ['Privacy Policy', [
    ['Information processed', 'Smart Proctoring processes account names, emails, student or employee identifiers, profiles and roles; courses, exams, answers, attempts, scores, grading, messages and violation records.'],
    ['Monitoring and evidence', 'Monitored exams use camera and microphone input for environment scans and face, attention, object and audio detection. Violations may generate image or audio evidence. Environment scans can be sent to configured analysis services. Review exam requirements before starting.'],
    ['Access and purpose', 'Data supports teaching, examination integrity, grading and administration. Authenticated roles and database policies govern access. Students access permitted learning records; Professors manage assigned teaching records; Cluster Professors review exams; Deans review integrity information; Admins manage accounts and courses. Automated flags support human review.'],
    ['Retention and requests', 'Archiving supported records preserves historical data. Contact your institution for access, correction, retention and deletion requests. The institution must define retention periods, service-provider disclosures and a privacy contact before production.']]],
  '/terms': ['Terms of Use', [
    ['Account use', 'Use your own authorized account for institutional learning, teaching or review. Keep credentials private. Do not impersonate others, tamper with records or bypass access controls.'],
    ['Examinations', 'Follow institutional examination rules. Some exams require camera, microphone, fullscreen and environment scans. Report technical interruptions to your instructor. Automated flags do not independently establish misconduct.'],
    ['Institutional decisions', 'The institution determines schedules, grading, approvals, accommodations and appeals. Contact your institution for disputes, accessibility needs or account support.']]],
  '/storage': ['Cookies & Local Storage', [
    ['Authentication', 'The Supabase client persists session information in browser storage and manages token refresh. The application caches profile information in localStorage and stores a login-in-this-tab marker in sessionStorage.'],
    ['Preferences and recovery', 'localStorage stores appearance and notification-preview preferences, selected query-cache data, local application state and exam progress for interruption recovery. Some local state contains demonstration data. Log out on shared devices.'],
    ['Browser controls', 'Clearing browser storage removes preferences and recovery state and may require login. It does not delete Supabase records. The inspected application does not explicitly set advertising or tracking cookies. Institutions must review any additional hosting and integrated services.']]],
};
export default function Legal() {
  const { pathname } = useLocation();
  const [title, sections] = pages[pathname] || pages['/privacy'];
  return <main className="app-shell legal-page"><h1>{title}</h1><p><strong>Project draft — institutional/legal review required before production deployment.</strong></p>{sections.map(([heading, text]) => <section key={heading}><h2>{heading}</h2><p>{text}</p></section>)}<LegalLinks /><Link to="/login">Back to Login</Link></main>;
}
