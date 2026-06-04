export const studentProfile = {
  id: "01868",
  fullName: "Ivan Caburnay",
  email: "student@university.edu",
  role: "Student",
};

export const studentCourses = [
  { id: "fre-3h", name: "FRE", section: "FRE313 - 3H" },
  { id: "aia-3a", name: "AIA", section: "AA - 3A" },
  { id: "course-3a", name: "COURSE", section: "crse313 - 3A" },
  { id: "aia313-3a", name: "AIA", section: "AIA313 - 3A" },
];

export const studentFolders = [
  { id: "finals", name: "FINALS", course: "AIA - 3A", type: "Course folder" },
  { id: "personal-a", name: "a", course: "Personal folder", type: "Personal folder" },
];

export const studentFiles = [
  { id: "file-1", folderId: "finals", name: "Completed Level 1 DFD.drawio", size: "19.5 KB" },
  { id: "file-2", folderId: "finals", name: "wireframeivan.pdf", size: "208.6 KB" },
];

export const studentGrades = [
  { id: "g1", courseId: "fre-3h", period: "Prelim", title: "123 - Quiz", score: 0 },
  { id: "g2", courseId: "fre-3h", period: "Prelim", title: "test - Exam", score: 100 },
  { id: "g3", courseId: "fre-3h", period: "Prelim", title: "test - Exam", score: 0 },
  { id: "g4", courseId: "fre-3h", period: "Prelim", title: "Testing - Exam", score: 100 },
  { id: "g5", courseId: "fre-3h", period: "Prelim", title: "e - Quiz", score: 0 },
  { id: "g6", courseId: "fre-3h", period: "Prelim", title: "12 - Quiz", score: 0 },
  { id: "a1", courseId: "aia-3a", period: "*", title: "Date: 5/23/2026", score: 0 },
  { id: "a2", courseId: "aia-3a", period: "*", title: "Date: 5/23/2026", score: 1 },
  { id: "a3", courseId: "aia-3a", period: "*", title: "Date: 5/23/2026", score: 0 },
  { id: "a4", courseId: "aia-3a", period: "*", title: "Date: 5/23/2026", score: 1 },
  { id: "a5", courseId: "aia-3a", period: "*", title: "Date: 5/23/2026", score: 0 },
  { id: "a6", courseId: "aia-3a", period: "*", title: "Date: 5/23/2026", score: 0 },
];

export const studentMembers = [
  { id: "01868", name: "Ivan Caburnay", initials: "I" },
];

export const studentMessages = [
  { id: "sm1", name: "Dr. Maria Santos", role: "Professor", lastMessage: "Please review the module before the quiz.", unread: 1 },
  { id: "sm2", name: "Course Support", role: "Admin", lastMessage: "Your course join request was recorded.", unread: 0 },
  { id: "sm3", name: "Prof. Nolan Lim", role: "Cluster Professor", lastMessage: "Exam instructions were updated.", unread: 1 },
];

export const studentNotifications = [
  { id: "sn1", title: "New resource uploaded", message: "FINALS folder has a new PDF file.", type: "Resources", isRead: false },
  { id: "sn2", title: "Grade posted", message: "Your Prelim quiz grade is now available.", type: "Grades", isRead: false },
  { id: "sn3", title: "Course joined", message: "You are enrolled in AIA - 3A.", type: "Course", isRead: true },
];
