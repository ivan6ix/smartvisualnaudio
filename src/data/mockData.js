export const roles = ["Admin", "Professor", "Dean", "Cluster Professor", "Student"];

export const professors = [
  { id: "p-101", name: "Dr. Maria Santos", email: "maria.santos@university.edu", employeeNumber: "EMP-1001", status: "Active" },
  { id: "p-102", name: "Prof. Daniel Reyes", email: "daniel.reyes@university.edu", employeeNumber: "EMP-1002", status: "Active" },
  { id: "p-103", name: "Dr. Elise Tan", email: "elise.tan@university.edu", employeeNumber: "EMP-1003", status: "Deactivated" },
];

export const deans = [
  { id: "d-201", name: "Dean Angela Cruz", email: "angela.cruz@university.edu", employeeNumber: "DEAN-2001", status: "Active" },
];

export const clusterProfessors = [
  { id: "c-301", name: "Prof. Nolan Lim", email: "nolan.lim@university.edu", employeeNumber: "CL-3001", status: "Active" },
];

export const courses = [
  { id: "cs101", courseName: "Computer Science 101", courseCode: "CS101", section: "A1", professor: "Dr. Maria Santos", joiningCode: "WJ7M3V", archived: false },
  { id: "it204", courseName: "Information Assurance", courseCode: "IT204", section: "B2", professor: "Prof. Daniel Reyes", joiningCode: "Q8KD2L", archived: false },
  { id: "ds330", courseName: "Data Systems", courseCode: "DS330", section: "C1", professor: "Dr. Elise Tan", joiningCode: "N5RA9P", archived: true },
];

export const accounts = [
  { id: "A-001", name: "Admin User", role: "Admin", status: "Active" },
  { id: "S-2022-0191", name: "Lia Mendoza", role: "Student", status: "Pending" },
  { id: "EMP-1001", name: "Dr. Maria Santos", role: "Professor", status: "Active" },
  { id: "DEAN-2001", name: "Dean Angela Cruz", role: "Dean", status: "Active" },
];

export const logs = [
  { id: 1, action: "Login", description: "Admin User signed in", createdAt: "2026-05-31 08:12" },
  { id: 2, action: "Course Creation", description: "CS101 was created", createdAt: "2026-05-31 08:27" },
  { id: 3, action: "Account Creation", description: "Professor account created", createdAt: "2026-05-31 09:04" },
  { id: 4, action: "Password Change", description: "Dean account password reset", createdAt: "2026-05-31 09:30" },
];

export const violations = [
  { id: 1, student: "Lia Mendoza", course: "CS101", exam: "Midterm", violationType: "MULTIPLE_FACE", date: "2026-05-31", time: "09:20", severity: "High" },
  { id: 2, student: "Arvin Cole", course: "IT204", exam: "Quiz 2", violationType: "BACKGROUND_VOICE", date: "2026-05-31", time: "10:15", severity: "Medium" },
  { id: 3, student: "Mira Lopez", course: "DS330", exam: "Final", violationType: "TAB_SWITCH", date: "2026-05-30", time: "14:42", severity: "Low" },
];

export const exams = [
  { id: 1, title: "CS101 Midterm", course: "Computer Science 101", status: "Active", duration: 90 },
  { id: 2, title: "IT204 Quiz 2", course: "Information Assurance", status: "Active", duration: 45 },
  { id: 3, title: "DS330 Final", course: "Data Systems", status: "Scheduled", duration: 120 },
  { id: 4, title: "Ethics Essay", course: "Professional Ethics", status: "Scheduled", duration: 60 },
  { id: 5, title: "Networks Lab", course: "Computer Networks", status: "Active", duration: 75 },
  { id: 6, title: "Algorithms Checkpoint", course: "Algorithms", status: "Draft", duration: 50 },
];

export const violationChart = [
  { name: "Multiple Face", count: 12 },
  { name: "No Face", count: 9 },
  { name: "Background Voice", count: 17 },
  { name: "Tab Switch", count: 21 },
  { name: "Copy Attempt", count: 6 },
  { name: "Fullscreen Exit", count: 14 },
];

export const conversations = [
  { id: 1, name: "Dr. Maria Santos", role: "Professor", lastMessage: "I uploaded the exam batch.", unread: 2 },
  { id: 2, name: "Dean Angela Cruz", role: "Dean", lastMessage: "Please send today reports.", unread: 0 },
  { id: 3, name: "Prof. Nolan Lim", role: "Cluster Professor", lastMessage: "Reviewing violations now.", unread: 1 },
];

export const adminNotifications = [
  { id: 1, title: "Account Activity", message: "Professor account created", type: "Account", unread: true },
  { id: 2, title: "Exam Activity", message: "CS101 Midterm started", type: "Exam", unread: true },
  { id: 3, title: "Violation", message: "Multiple face detected", type: "Violation", unread: true },
  { id: 4, title: "Message", message: "Dean Angela sent a message", type: "Message", unread: false },
  { id: 5, title: "Course Creation", message: "Information Assurance course added", type: "Course", unread: true },
];
