import { createRoot } from "react-dom/client";
import App from "@/app/App";
import "@/styles/index.css";
import { reloadForNewBuild } from "@/lib/staleBuild";

// Vite fires this when a lazily loaded chunk (or its CSS) can't be fetched, e.g. after a new deploy.
window.addEventListener("vite:preloadError", (event) => {
  if (reloadForNewBuild()) event.preventDefault();
});

createRoot(document.getElementById("root")!).render(<App />);
