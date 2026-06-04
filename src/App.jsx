import { Navigate, Route, Routes } from "react-router-dom";
import ProtectedRoute from "./routes/ProtectedRoute";
import Accounts from "./pages/Accounts";
import ClusterDashboard from "./pages/cluster/ClusterDashboard";
import ClusterExamList from "./pages/cluster/ClusterExamList";
import ClusterExamReview from "./pages/cluster/ClusterExamReview";
import ClusterHistory from "./pages/cluster/ClusterHistory";
import ClusterLayout from "./pages/cluster/ClusterLayout";
import ClusterMessages from "./pages/cluster/ClusterMessages";
import ClusterNotifications from "./pages/cluster/ClusterNotifications";
import ClusterProfile from "./pages/cluster/ClusterProfile";
import ClusterReports from "./pages/cluster/ClusterReports";
import Courses from "./pages/Courses";
import Dashboard from "./pages/Dashboard";
import DeanDashboard from "./pages/dean/DeanDashboard";
import DeanExamIntegrity from "./pages/dean/DeanExamIntegrity";
import DeanLayout from "./pages/dean/DeanLayout";
import ForgotPassword from "./pages/ForgotPassword";
import Login from "./pages/Login";
import Messages from "./pages/Messages";
import Notifications from "./pages/Notifications";
import People from "./pages/People";
import ProfessorDashboard from "./pages/professor/ProfessorDashboard";
import ProfessorCreateExam from "./pages/professor/ProfessorCreateExam";
import ProfessorCourseDetail from "./pages/professor/ProfessorCourseDetail";
import ProfessorCoursePermits from "./pages/professor/ProfessorCoursePermits";
import ProfessorCourses from "./pages/professor/ProfessorCourses";
import ProfessorExams from "./pages/professor/ProfessorExams";
import ProfessorLayout from "./pages/professor/ProfessorLayout";
import ProfessorMessages from "./pages/professor/ProfessorMessages";
import ProfessorMonitoring from "./pages/professor/ProfessorMonitoring";
import ProfessorScores from "./pages/professor/ProfessorScores";
import Register from "./pages/Register";
import Reports from "./pages/Reports";
import ResetPassword from "./pages/ResetPassword";
import SecurityPrivacy from "./pages/SecurityPrivacy";
import StudentCourse from "./pages/student/StudentCourse";
import StudentDashboard from "./pages/student/StudentDashboard";
import StudentExamTake from "./pages/student/StudentExamTake";
import StudentGrades from "./pages/student/StudentGrades";
import StudentLayout from "./pages/student/StudentLayout";
import StudentMessages from "./pages/student/StudentMessages";
import StudentResources from "./pages/student/StudentResources";

export default function App() {
  return (
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
  );
}
