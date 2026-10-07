import { useAuth } from "./use-auth";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

/**
 * Returns the current user's preferred timezone (e.g. "Asia/Manila"),
 * or empty string if not set (falls back to browser default).
 */
export function useUserTimezone() {
  const { user } = useAuth();
  const settings = useQuery(
    api.users.getSettings,
    user ? { userId: user._id } : "skip",
  );
  return settings?.timezone ?? "";
}
