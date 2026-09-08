import { FiUser } from "react-icons/fi";

export default function ProfileAvatar({ className = "", name = "User", src = "" }) {
  return (
    <span className={`profile-avatar ${className}`}>
      {src ? <img alt={`${name} profile`} decoding="async" loading="lazy" src={src} /> : <FiUser />}
    </span>
  );
}
