import { Link, useLocation } from "react-router-dom";
import LegalLinks from "../components/LegalLinks";

const draftNotice = "Project draft — institutional/legal review required before production deployment.";

const pages = {
  "/privacy": ["Privacy Policy", [
    ["Information Processed", "Smart Proctoring processes account names, emails, student or employee identifiers, profiles and roles; courses, exams, questions, answers, attempts, scores, grading, messages, notifications, activity logs and violation records. Uploaded files may include profile pictures, course materials, permit files, student resources, exam submissions, proctoring snapshots and audio evidence when those features are used."],
    ["Monitoring and Evidence", "Monitored exams may use camera and microphone input for environment scans and face, attention, object and audio detection when enabled for an exam. Potential violations may generate image snapshots, audio evidence, timestamps, severity labels and descriptions. Review exam requirements before starting."],
    ["Access and Purpose", "Data supports teaching, examination integrity, grading, account administration, course management, review workflows and support. Application roles and configured database/storage access policies are used to control access. Students access permitted learning records; Professors manage assigned teaching records; Cluster Professors review exams; Deans review integrity information; Admins manage accounts, courses and reports."],
    ["Automated Monitoring and Human Review", "Automated monitoring can flag potential events such as no detected face, multiple detected faces, looking away or down, fullscreen exit, microphone access or muting issues, background voice or loud audio, detected phones or gadgets, and environment-scan risks. These detections create potential violations or review flags. An automated flag is not automatic proof of academic misconduct and is intended to support review by authorized institutional users."],
    ["Data Security", "The application uses Supabase Authentication with persistent sessions, token refresh and session validation. Application routes are restricted by authenticated role, and Supabase Row Level Security policies are configured for core tables and supported storage buckets. Storage access uses bucket policies, public profile-picture URLs where configured, and signed URLs for private resources such as course materials, permits, submissions, snapshots and audio evidence. These are reasonable technical and access-control measures, not a guarantee that risk is eliminated."],
    ["Service Providers", "Supabase is used for authentication, database records, realtime updates, edge functions and storage where configured. Roboflow or a configured environment-scan endpoint may be used for environment or object analysis when enabled. If live Roboflow monitoring or direct image detection is configured, camera images, frames or video-derived data may be transmitted to that external processing service for monitoring analysis. MediaPipe and TensorFlow browser models may be loaded for client-side face or object detection. The institution must review hosting and any configured integrated services before production."],
    ["Retention and Requests", "Records such as exams, attempts, scores, violations, evidence, messages, files and activity records may need to remain available under institutional or academic-record requirements. Some features use archive or soft-delete behavior, which may preserve historical records instead of immediately deleting them. The institution determines applicable retention periods and processes for access, correction, deletion, appeals, accommodations and related requests. Contact details and final request-handling procedures must be configured by the institution before production."],
  ]],
  "/terms": ["Terms of Use", [
    ["Account Use", "Use your own authorized account for institutional learning, teaching, administration or review. Keep credentials private and sign out on shared devices."],
    ["Acceptable Use", "Use the system only for authorized academic or institutional purposes according to your assigned role. Students participate in authorized courses and exams; Professors manage authorized teaching, course and exam activities; Cluster Professors perform assigned review responsibilities; Deans and Admins perform authorized administrative, reporting and integrity-review responsibilities."],
    ["Examinations", "Follow institutional examination rules and the requirements shown for each exam. Some exams may enable randomized questions or choices, attempt limits, file submissions, camera monitoring, microphone monitoring, fullscreen mode, environment scans and snapshot capture."],
    ["Proctoring Requirements", "If an exam requires camera, microphone, fullscreen, environment scan or active monitoring, you must provide the required access before or during the exam. Review exam requirements before starting and report access or device problems through institutional channels."],
    ["Prohibited Conduct", "Do not impersonate another user, share credentials, access records without authorization, intentionally tamper with application records, bypass access controls, manipulate exam or proctoring functionality, interfere with required monitoring, or alter grades, attempts, evidence or exam records without authorization."],
    ["Violations and Review", "The application may record potential proctoring violations such as no face, multiple faces, looking away, fullscreen exit, microphone issues, background voice or loud audio, phones, gadgets and environment-scan findings. Detected events are potential violations or flagged events available for authorized review. Automated flags do not independently establish misconduct."],
    ["Technical Interruptions", "Connectivity loss, unexpected browser closure, device shutdown, power interruption, camera or microphone loss, or fullscreen exit may affect an active exam according to the implemented exam rules. The application stores temporary local progress for recovery and may restore saved answers, scan status and violations. The current violation limit is 5; when the configured violation threshold is reached, the application may automatically finalize or initiate submission of the active attempt according to the exam rules."],
    ["Institutional Decisions", "The institution determines schedules, grading, approvals, accommodations, appeals, account status, request handling and final handling of flagged events. Contact your institution for disputes, accessibility needs or account support."],
    ["System Availability", "Temporary service interruptions may occur because of maintenance, network issues, service-provider availability, browser/device problems or other technical issues. The system does not promise uninterrupted availability or zero data loss."],
    ["Changes to These Terms", "The institution may update these Terms when the system, institutional requirements or policies change. Material changes should be communicated appropriately before production use."],
  ]],
  "/storage": ["Cookies & Local Storage", [
    ["Authentication", "The Supabase client persists authentication session information in browser storage and manages token refresh. The application also caches the current user profile in localStorage and stores a login-in-this-tab marker in sessionStorage."],
    ["Preferences and Recovery", "localStorage stores the light/dark appearance preference, notification-preview preferences, selected query-cache data and local fallback state used when Supabase is not configured. Development/demo mode may include demonstration user or message data in local state. Log out on shared devices."],
    ["Exam Recovery Data", "During an active exam, localStorage may temporarily store answers, recorded violations, scan status, start time and timer state for interruption recovery. While a Professor creates an exam, localStorage may also temporarily store professor-scoped draft form and question recovery snapshots before or between Supabase draft saves. Authoritative exam attempts, answers, violations, evidence and synced drafts may also be stored in Supabase. Clearing browser storage can remove local recovery information but does not delete backend records."],
    ["Browser Storage", "The inspected application does not explicitly set advertising or tracking cookies. Authentication, hosting or integrated services may use their own browser-side storage according to their configuration, so the institution must review the deployed environment before production."],
    ["Browser Controls", "Clearing browser storage removes preferences, cached profile data, query cache and exam recovery state and may require login. It does not delete Supabase records or institutional records stored in the backend."],
  ]],
};

const subtitles = {
  "/privacy": "How Smart Proctoring processes and protects information.",
  "/terms": "Authorized use, exam responsibilities and institutional review expectations.",
  "/storage": "How browser storage supports sign-in, preferences and exam recovery.",
};

function getSectionId(heading) {
  return heading.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function Legal() {
  const { pathname } = useLocation();
  const [title, sections] = pages[pathname] || pages["/privacy"];
  const subtitle = subtitles[pathname] || subtitles["/privacy"];

  return (
    <main className="app-shell legal-page">
      <div className="legal-page-shell">
        <header className="legal-page-header">
          <span>Smart Proctoring Policy</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </header>

        <aside className="legal-draft-notice">
          <strong>{draftNotice}</strong>
        </aside>

        <nav className="legal-toc" aria-label={`${title} sections`}>
          <span>On this page</span>
          <div>
            {sections.map(([heading]) => (
              <a href={`#${getSectionId(heading)}`} key={heading}>{heading}</a>
            ))}
          </div>
        </nav>

        <div className="legal-section-list">
          {sections.map(([heading, text]) => (
            <section className="legal-section-card" id={getSectionId(heading)} key={heading}>
              <h2>{heading}</h2>
              <p>{text}</p>
            </section>
          ))}
        </div>

        <footer className="legal-page-footer">
          <LegalLinks />
          <Link className="legal-back-link" to="/login">Back to Login</Link>
        </footer>
      </div>
    </main>
  );
}
