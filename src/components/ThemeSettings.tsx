import { useState } from "react";
import { savedTheme, saveTheme, type Theme } from "../theme";
export function ThemeSettings() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  return (
    <section
      className="panel settings-card theme-picker"
      aria-labelledby="appearance-title"
    >
      <h2 id="appearance-title">Appearance</h2>
      <label className="field-label">
        Theme
        <select
          value={theme}
          onChange={(event) => {
            const next = event.target.value as Theme;
            setTheme(next);
            saveTheme(next);
          }}
        >
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>
      <p>
        Your preference is saved on this browser. Dark mode uses brighter text
        for easier reading.
      </p>
    </section>
  );
}
