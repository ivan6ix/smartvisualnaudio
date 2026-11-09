// Where each role lands after signing in. Admins use the root dashboard.
export const ROLE_HOME = {
  Dean: "/dean",
  Professor: "/professor",
  "Cluster Professor": "/cluster",
  Student: "/student",
};

export function homeForRole(role) {
  return ROLE_HOME[role] || "/";
}
