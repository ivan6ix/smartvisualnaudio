import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./routes/ProtectedRoute";
import { PageSkeleton } from "./components/ui";

const Accounts = lazy(() => import("./pages/Accounts"));
const ClusterDashboard = lazy(() => import("./pages/cluster/ClusterDashboard"));
const ClusterExamList = lazy(() => import("./pages/cluster/ClusterExamList"));
const ClusterExamReview = lazy(() => import("./pages/cluster/ClusterExamReview"));
const ClusterHistory = lazy(() => import("./pages/cluster/ClusterHistory"));
const ClusterLayout = lazy(() => import("./pages/cluster/ClusterLayout"));
const ClusterMessages = lazy(() => import("./pages/cluster/ClusterMessages"));
const ClusterNotifications = lazy(() => import("./pages/cluster/ClusterNotifications"));
const ClusterProfile = lazy(() => import("./pages/cluster/ClusterProfile"));
const ClusterReports = lazy(() => import("./pages/cluster/ClusterReports"));
const Courses = lazy(() => import("./pages/Courses"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const DeanDashboard = lazy(() => import("./pages/dean/DeanDashboard"));
const DeanExamIntegrity = lazy(() => import("./pages/dean/DeanExamIntegrity"));
const DeanLayout = lazy(() => import("./pages/dean/DeanLayout"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const Login = lazy(() => import("./pages/Login"));
const Messages = lazy(() => import("./pages/Messages"));
const Notifications = lazy(() => import("./pages/Notifications"));
const People = lazy(() => import("./pages/People"));
const ProfessorDashboard = lazy(() => import("./pages/professor/ProfessorDashboard"));
const ProfessorCreateExam = lazy(() => import("./pages/professor/ProfessorCreateExam"));
const ProfessorCourseDetail = lazy(() => import("./pages/professor/ProfessorCourseDetail"));
const ProfessorCoursePermits = lazy(() => import("./pages/professor/ProfessorCoursePermits"));
const ProfessorCourses = lazy(() => import("./pages/professor/ProfessorCourses"));
const ProfessorExams = lazy(() => import("./pages/professor/ProfessorExams"));
const ProfessorLayout = lazy(() => import("./pages/professor/ProfessorLayout"));
const ProfessorMessages = lazy(() => import("./pages/professor/ProfessorMessages"));
const ProfessorMonitoring = lazy(() => import("./pages/professor/ProfessorMonitoring"));
const ProfessorScores = lazy(() => import("./pages/professor/ProfessorScores"));
const Register = lazy(() => import("./pages/Register"));
const Reports = lazy(() => import("./pages/Reports"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const SecurityPrivacy = lazy(() => import("./pages/SecurityPrivacy"));
const StudentCourse = lazy(() => import("./pages/student/StudentCourse"));
const StudentDashboard = lazy(() => import("./pages/student/StudentDashboard"));
const StudentExamTake = lazy(() => import("./pages/student/StudentExamTake"));
const StudentGrades = lazy(() => import("./pages/student/StudentGrades"));
const StudentLayout = lazy(() => import("./pages/student/StudentLayout"));
const StudentMessages = lazy(() => import("./pages/student/StudentMessages"));
const StudentResources = lazy(() => import("./pages/student/StudentResources"));

export default function App() {
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
