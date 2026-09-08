import { FiCheck, FiMoon, FiSun } from "react-icons/fi";
import { useTheme } from "../context/ThemeContext";

const modes = [
  { id: "light", label: "Light Mode", description: "Light surfaces with dark text and borders.", Icon: FiSun },
  { id: "dark", label: "Dark Mode", description: "Dark surfaces with light text and borders.", Icon: FiMoon },
];

export default function ThemeSettings() {
  const { setTheme, theme } = useTheme();

  return (
    <div className="theme-settings">
      <div className="theme-settings-heading">
        <div>
          <h2>Appearance</h2>
          <p>Choose a theme for the entire Smart Proctoring System.</p>
        </div>
      </div>
      <div className="theme-mode-grid" role="radiogroup" aria-label="Application theme">
        {modes.map(({ id, label, description, Icon }) => (
          <button aria-checked={theme === id} className={theme === id ? "active" : ""} key={id} onClick={() => setTheme(id)} role="radio" type="button">
            <Icon />
            <span><strong>{label}</strong><small>{description}</small></span>
            {theme === id ? <FiCheck className="theme-mode-check" /> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
