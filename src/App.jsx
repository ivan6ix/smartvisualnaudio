import { lazy, Suspense, useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./routes/ProtectedRoute";
import { PageSkeleton } from "./components/ui";

const pageImports = {
  Accounts: () => import("./pages/Accounts"),
  ClusterDashboard: () => import("./pages/cluster/ClusterDashboard"),
  ClusterExamList: () => import("./pages/cluster/ClusterExamList"),
  ClusterExamReview: () => import("./pages/cluster/ClusterExamReview"),
  ClusterHistory: () => import("./pages/cluster/ClusterHistory"),
  ClusterLayout: () => import("./pages/cluster/ClusterLayout"),
  ClusterMessages: () => import("./pages/cluster/ClusterMessages"),
  ClusterNotifications: () => import("./pages/cluster/ClusterNotifications"),
  ClusterProfile: () => import("./pages/cluster/ClusterProfile"),
  ClusterReports: () => import("./pages/cluster/ClusterReports"),
  Courses: () => import("./pages/Courses"),
  Dashboard: () => import("./pages/Dashboard"),
  DeanDashboard: () => import("./pages/dean/DeanDashboard"),
  DeanExamIntegrity: () => import("./pages/dean/DeanExamIntegrity"),
  DeanLayout: () => import("./pages/dean/DeanLayout"),
  ForgotPassword: () => import("./pages/ForgotPassword"),
  Login: () => import("./pages/Login"),
  Messages: () => import("./pages/Messages"),
  Notifications: () => import("./pages/Notifications"),
  People: () => import("./pages/People"),
  ProfessorDashboard: () => import("./pages/professor/ProfessorDashboard"),
  ProfessorCreateExam: () => import("./pages/professor/ProfessorCreateExam"),
  ProfessorCourseDetail: () => import("./pages/professor/ProfessorCourseDetail"),
  ProfessorCoursePermits: () => import("./pages/professor/ProfessorCoursePermits"),
  ProfessorCourses: () => import("./pages/professor/ProfessorCourses"),
  ProfessorExams: () => import("./pages/professor/ProfessorExams"),
  ProfessorLayout: () => import("./pages/professor/ProfessorLayout"),
  ProfessorMessages: () => import("./pages/professor/ProfessorMessages"),
  ProfessorMonitoring: () => import("./pages/professor/ProfessorMonitoring"),
  ProfessorScores: () => import("./pages/professor/ProfessorScores"),
  Register: () => import("./pages/Register"),
  Reports: () => import("./pages/Reports"),
  ResetPassword: () => import("./pages/ResetPassword"),
  SecurityPrivacy: () => import("./pages/SecurityPrivacy"),
  StudentCourse: () => import("./pages/student/StudentCourse"),
  StudentDashboard: () => import("./pages/student/StudentDashboard"),
  StudentExamTake: () => import("./pages/student/StudentExamTake"),
  StudentGrades: () => import("./pages/student/StudentGrades"),
  StudentLayout: () => import("./pages/student/StudentLayout"),
  StudentMessages: () => import("./pages/student/StudentMessages"),
  StudentResources: () => import("./pages/student/StudentResources"),
};

const Accounts = lazy(pageImports.Accounts);
const ClusterDashboard = lazy(pageImports.ClusterDashboard);
const ClusterExamList = lazy(pageImports.ClusterExamList);
const ClusterExamReview = lazy(pageImports.ClusterExamReview);
const ClusterHistory = lazy(pageImports.ClusterHistory);
const ClusterLayout = lazy(pageImports.ClusterLayout);
const ClusterMessages = lazy(pageImports.ClusterMessages);
const ClusterNotifications = lazy(pageImports.ClusterNotifications);
const ClusterProfile = lazy(pageImports.ClusterProfile);
const ClusterReports = lazy(pageImports.ClusterReports);
const Courses = lazy(pageImports.Courses);
const Dashboard = lazy(pageImports.Dashboard);
const DeanDashboard = lazy(pageImports.DeanDashboard);
const DeanExamIntegrity = lazy(pageImports.DeanExamIntegrity);
const DeanLayout = lazy(pageImports.DeanLayout);
const ForgotPassword = lazy(pageImports.ForgotPassword);
const Login = lazy(pageImports.Login);
const Messages = lazy(pageImports.Messages);
const Notifications = lazy(pageImports.Notifications);
const People = lazy(pageImports.People);
const ProfessorDashboard = lazy(pageImports.ProfessorDashboard);
const ProfessorCreateExam = lazy(pageImports.ProfessorCreateExam);
const ProfessorCourseDetail = lazy(pageImports.ProfessorCourseDetail);
const ProfessorCoursePermits = lazy(pageImports.ProfessorCoursePermits);
const ProfessorCourses = lazy(pageImports.ProfessorCourses);
const ProfessorExams = lazy(pageImports.ProfessorExams);
const ProfessorLayout = lazy(pageImports.ProfessorLayout);
const ProfessorMessages = lazy(pageImports.ProfessorMessages);
const ProfessorMonitoring = lazy(pageImports.ProfessorMonitoring);
const ProfessorScores = lazy(pageImports.ProfessorScores);
const Register = lazy(pageImports.Register);
const Reports = lazy(pageImports.Reports);
const ResetPassword = lazy(pageImports.ResetPassword);
const SecurityPrivacy = lazy(pageImports.SecurityPrivacy);
const StudentCourse = lazy(pageImports.StudentCourse);
const StudentDashboard = lazy(pageImports.StudentDashboard);
const StudentExamTake = lazy(pageImports.StudentExamTake);
const StudentGrades = lazy(pageImports.StudentGrades);
const StudentLayout = lazy(pageImports.StudentLayout);
const StudentMessages = lazy(pageImports.StudentMessages);
const StudentResources = lazy(pageImports.StudentResources);

function preloadPortalPages() {
  Object.entries(pageImports).forEach(([name, load]) => {
    if (name === "StudentExamTake") return;
    void load();
  });
}

export default function App() {
  useEffect(() => {
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(preloadPortalPages, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }

    const id = window.setTimeout(preloadPortalPages, 1200);
    return () => window.clearTimeout(id);
  }, []);

  return (
    <Suspense fallback={<PageSkeleton />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/cluster" element={<ClusterLayout />}>
          <Route index element={<ClusterDashboard />} />
          <Route path="pending" element={<ClusterExamList status="Pending Review" />} />
          <Route path="approved" element={<ClusterExamList status="Approved" />} />
          <Route path="rejected" element={<ClusterExamList status="Rejected" />} />
          <Route path="exams/:id" element={<ClusterExamReview />} />
          <Route path="history" element={<ClusterHistory />} />
          <Route path="reports" element={<ClusterReports />} />
          <Route path="messages" element={<ClusterMessages />} />
          <Route path="notifications" element={<ClusterNotifications />} />
          <Route path="profile" element={<ClusterProfile />} />
        </Route>
        <Route path="/professor" element={<ProfessorLayout />}>
          <Route index element={<ProfessorDashboard />} />
          <Route path="courses" element={<ProfessorCourses />} />
          <Route path="courses/:courseId/:tab" element={<ProfessorCourseDetail />} />
          <Route path="courses/:courseId/permits" element={<ProfessorCoursePermits />} />
          <Route path="exams" element={<ProfessorExams />} />
          <Route path="exams/create" element={<ProfessorCreateExam />} />
          <Route path="monitoring" element={<ProfessorMonitoring />} />
          <Route path="scores" element={<ProfessorScores />} />
          <Route path="messages" element={<ProfessorMessages />} />
          <Route path="profile" element={<SecurityPrivacy />} />
        </Route>
        <Route path="/student" element={<StudentLayout />}>
          <Route index element={<StudentDashboard />} />
          <Route path="resources" element={<StudentResources />} />
          <Route path="grades" element={<StudentGrades />} />
          <Route path="messages" element={<StudentMessages />} />
          <Route path="exams/:examId" element={<StudentExamTake />} />
          <Route path="courses/:courseId/:tab" element={<StudentCourse />} />
        </Route>
        <Route path="/dean" element={<DeanLayout />}>
          <Route index element={<DeanDashboard />} />
          <Route path="integrity" element={<DeanExamIntegrity />} />
          <Route path="courses" element={<Courses />} />
          <Route path="reports" element={<Reports />} />
          <Route path="profile" element={<SecurityPrivacy />} />
        </Route>
        <Route element={<ProtectedRoute roles={["Admin"]} />}>
          <Route index element={<Dashboard />} />
          <Route path="/create-account" element={<People />} />
          <Route path="/professors" element={<People type="Professor" />} />
          <Route path="/deans" element={<People type="Dean" />} />
          <Route path="/cluster-professors" element={<People type="Cluster Professor" />} />
          <Route path="/courses" element={<Courses />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/security" element={<SecurityPrivacy />} />
          <Route path="/reports" element={<Reports />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
