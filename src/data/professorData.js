export const professorProfile = {
  id: "p-101",
  fullName: "Dr. Maria Santos",
  email: "professor@university.edu",
  role: "Professor",
  accountStatus: "Active",
  createdAt: "2026-04-20",
};

export const professorCourses = [
  { id: "CS101-A1", courseName: "Computer Science 101", courseCode: "CS101", section: "A1", students: 42 },
  { id: "CN202-A2", courseName: "Computer Networks", courseCode: "CN202", section: "A2", students: 36 },
  { id: "ALG301-D1", courseName: "Algorithms", courseCode: "ALG301", section: "D1", students: 31 },
];

export const professorExams = [
  { id: "PEX-1001", title: "CS101 Midterm", course: "Computer Science 101", section: "A1", status: "Published", duration: 90, createdAt: "2026-05-27", attempts: 38 },
  { id: "PEX-1002", title: "Arrays and Functions Quiz", course: "Computer Science 101", section: "A1", status: "Draft", duration: 35, createdAt: "2026-05-29", attempts: 0 },
  { id: "PEX-1003", title: "Networks Lab Check", course: "Computer Networks", section: "A2", status: "Published", duration: 75, createdAt: "2026-05-26", attempts: 29 },
  { id: "PEX-1004", title: "Routing Fundamentals", course: "Computer Networks", section: "A2", status: "Pending Review", duration: 60, createdAt: "2026-05-30", attempts: 0 },
  { id: "PEX-1005", title: "Sorting Algorithms Checkpoint", course: "Algorithms", section: "D1", status: "Published", duration: 50, createdAt: "2026-05-24", attempts: 27 },
  { id: "PEX-1006", title: "Complexity Analysis Quiz", course: "Algorithms", section: "D1", status: "Draft", duration: 40, createdAt: "2026-05-31", attempts: 0 },
  { id: "PEX-1007", title: "Recursion Review", course: "Algorithms", section: "D1", status: "Closed", duration: 45, createdAt: "2026-05-18", attempts: 30 },
];

export const professorAlerts = [
  { id: "A-1001", exam: "CS101 Midterm", student: "Lia Mendoza", activity: "Multiple face detected", severity: "High", time: "10:42" },
  { id: "A-1002", exam: "Networks Lab Check", student: "Arvin Cole", activity: "Background voice detected", severity: "Medium", time: "10:38" },
  { id: "A-1003", exam: "CS101 Midterm", student: "Mira Lopez", activity: "Tab switch attempt", severity: "Medium", time: "10:31" },
  { id: "A-1004", exam: "Sorting Algorithms Checkpoint", student: "Noah Cruz", activity: "Looking away repeatedly", severity: "Low", time: "10:28" },
];

export const professorMessages = [
  { id: "pm1", name: "Prof. Nolan Lim", role: "Cluster Professor", lastMessage: "Your routing exam is queued for review.", unread: 1 },
  { id: "pm2", name: "Dean Angela Cruz", role: "Dean", lastMessage: "Please submit score summaries by Friday.", unread: 0 },
  { id: "pm3", name: "Admin User", role: "Admin", lastMessage: "Your course resources were uploaded.", unread: 1 },
];

export const professorNotifications = [
  { id: "pn1", title: "Exam published", message: "CS101 Midterm is now visible to students.", type: "Exam", isRead: false },
  { id: "pn2", title: "Monitoring alert", message: "Multiple face detected in CS101 Midterm.", type: "Alert", isRead: false },
  { id: "pn3", title: "Review update", message: "Routing Fundamentals is pending cluster review.", type: "Review", isRead: true },
];
