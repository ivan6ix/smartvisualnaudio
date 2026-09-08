import { Toaster } from "sonner";
import { useTheme } from "../context/ThemeContext";

export default function ThemeToaster() {
  const { theme } = useTheme();
  return <Toaster theme={theme} position="top-center" richColors />;
}
