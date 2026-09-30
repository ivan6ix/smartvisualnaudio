const ROUTES_BY_ROLE = {
  Admin: {
    profile: "/profile",
    security: "/security",
    notifications: "/notifications",
  },
  Professor: {
    profile: "/professor/profile",
    security: "/professor/security",
    notifications: "/professor/notifications",
  },
  Student: {
    profile: "/student/profile",
    security: "/student/security",
    notifications: "/student/notifications",
  },
  "Cluster Professor": {
    profile: "/cluster/profile",
    security: "/cluster/security",
    notifications: "/cluster/notifications",
  },
  Dean: {
    profile: "/dean/profile",
    security: "/dean/security",
    notifications: "/dean/notifications",
  },
};

export function getProfileMenuRoutes(role) {
  return ROUTES_BY_ROLE[role] || ROUTES_BY_ROLE.Admin;
}
