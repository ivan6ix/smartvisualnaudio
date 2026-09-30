import { useState } from "react";
import { FiLogOut, FiShield, FiUser } from "react-icons/fi";
import { useNavigate } from "react-router-dom";
import { getProfileMenuRoutes } from "../lib/profileMenuRoutes";
import ProfileAvatar from "./ProfileAvatar";

export default function ProfileMenu({ className = "profile-menu", icon: ProfileIcon = FiUser, user, logout }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const routes = getProfileMenuRoutes(user?.role);

  function goTo(path) {
    navigate(path);
    setOpen(false);
  }

  return (
    <div className={`${className} ${open ? "open" : ""}`}>
      <button aria-label="Open profile menu" onClick={() => setOpen((current) => !current)} title="Profile" type="button">
        <ProfileAvatar name={user?.fullName} src={user?.avatarUrl} />
      </button>
      <div>
        <button onClick={() => goTo(routes.profile)} type="button"><ProfileIcon /> Profile Settings</button>
        <button onClick={() => goTo(routes.security)} type="button"><FiShield /> Security & Privacy</button>
        <button onClick={logout} type="button"><FiLogOut /> Logout</button>
      </div>
    </div>
  );
}
