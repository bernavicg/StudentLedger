import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * Captures Chrome's beforeinstallprompt so the app can offer its own
 * "Install app" action (Android: Add to Home screen as a standalone app).
 * Reports installed when already running in the app display mode.
 */
export function usePwaInstall() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(display-mode: standalone)").matches === true,
  );

  useEffect(() => {
    const onPrompt = (e: Event) => {
      // Keep the install in-house instead of Chrome's mini-infobar.
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setEvent(null);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const isAvailable = event !== null;

  const install = async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!event) return "unavailable";
    await event.prompt();
    const choice = await event.userChoice;
    setEvent(null);
    return choice.outcome;
  };

  return { isAvailable, installed, install };
}
