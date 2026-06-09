import { FiUser } from "react-icons/fi";

export default function ProfileAvatar({ className = "", name = "User", src = "" }) {
  return (
    <span className={`profile-avatar ${className}`}>
      {src ? <img alt={`${name} profile`} src={src} /> : <FiUser />}
    </span>
  );
}
