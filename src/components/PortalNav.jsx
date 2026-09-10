import { useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../context/ThemeContext";
export default function PortalNav({ children }) {
  const [open, setOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const themeAction = theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode";
  const ThemeIcon = theme === "light" ? Moon : Sun;
  return <div className="portal-navigation">
    <button className="portal-menu-toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>Menu</button>
    <nav className={open ? "portal-links open" : "portal-links"} aria-label="Portal navigation" onClick={() => setOpen(false)}>{children}</nav>
    <button className="portal-theme-toggle" type="button" onClick={toggleTheme} aria-label={themeAction} title={themeAction}><ThemeIcon size={20} aria-hidden="true" /></button>
  </div>;
}
