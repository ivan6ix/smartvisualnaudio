export const roles = [
  { name: "Admin", title: "A clear view of your institution.", description: "Bring people, courses, and oversight together. Keep your examination environment organized from one central workspace.", features: ["Manage accounts and professors", "Organize courses and access", "Review system reports and activity logs"], preview: ["Account management", "Course administration", "Activity & reports"] },
  { name: "Professor", title: "From your first question to the final grade.", description: "Build assessments your way, set the rules, and turn submissions into meaningful results—all in one connected workflow.", features: ["Create, schedule, and publish examinations", "Configure questions, scoring, and attempts", "Review evidence and grade individual answers"], preview: ["Exam workspace", "Monitoring overview", "Results & grading"] },
  { name: "Cluster Professor", title: "Better exams start with a second perspective.", description: "Give every submitted examination a thoughtful review before it reaches students. Keep feedback and approval decisions connected.", features: ["Review submitted examinations", "Approve, reject, or return for revision", "Follow examination review history"], preview: ["Pending reviews", "Approval decisions", "Review history"] },
  { name: "Student", title: "More focus. A clearer path forward.", description: "Find your courses, understand your exam requirements, and keep track of your progress with everything in one place.", features: ["Join courses and access assigned exams", "Take permitted attempts and view grades", "Request eligible attempt reopenings"], preview: ["My courses", "Assigned examinations", "Grades & attempts"] },
  { name: "Dean", title: "The bigger picture, without losing the details.", description: "Connect examination oversight with the information behind each decision, from approval status to integrity records.", features: ["Oversee examination approvals", "Review integrity violations and exam histories", "Access reports for informed oversight"], preview: ["Examination oversight", "Integrity review", "Institution reports"] },
];

export const steps = [
  { title: "Create", text: "Build your questions, set scoring and attempt rules, and schedule the examination." },
  { title: "Review & approve", text: "Move exams through the review process with clear feedback and approval decisions." },
  { title: "Take with monitoring", text: "Guide students through preparation and configured audio and visual monitoring." },
  { title: "Grade & review", text: "Review evidence, grade responses, and explore results one question at a time." },
];

export const faqs = [
  { question: "Will students need a camera and microphone?", answer: "Examinations with audio and visual monitoring require camera and microphone access. Students may also complete an environment scan before starting. The requirements depend on the examination's configuration. This landing-page demonstration does not access either device." },
  { question: "What happens when an event is flagged?", answer: "Configured events can be recorded with evidence for authorized staff to review. A flag provides context for review; it is not, on its own, a conclusion about misconduct. An examination can automatically submit when its configured violation limit is reached." },
  { question: "What if a student's connection drops?", answer: "The system supports controlled pause and recovery for interruptions. Examination timers, deadlines, and attempt rules still apply; recovery does not grant extra time or an additional attempt outside those rules." },
  { question: "Can students take an examination more than once?", answer: "Professors can permit multiple or unlimited attempts. Students can review attempt histories and results, and request the reopening of eligible submitted attempts. Availability depends on the examination settings and approval rules." },
  { question: "How do I access the platform?", answer: "Sign in with your existing account, or use Create account to start registration. Your assigned role determines the tools and information available to you. Contact your institution's administrator if you need help with your access." },
];
