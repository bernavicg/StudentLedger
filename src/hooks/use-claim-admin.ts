import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { useCallback } from "react";
import { toast } from "sonner";

/**
 * One-time admin bootstrap. While no account holds the admin role, the first
 * signed-in user sees a claim banner; claiming makes them the admin. After
 * that, admins manage roles from the Admin page.
 */
export function useClaimAdmin() {
  const { user } = useAuth();
  const claimAdmin = useMutation(api.users.claimAdmin);

  // A stable, cheap check: is there any admin yet?
  const adminExists = useQuery(api.users.adminExists);

  const claim = useCallback(async () => {
    try {
      const result = await claimAdmin({});
      if (result === "claimed") {
        toast.success("You're now the admin.");
      } else {
        toast.error("Someone already claimed the admin role.");
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not claim admin.",
      );
    }
  }, [claimAdmin]);

  return {
    // Only offer the banner while no admin exists and the viewer is signed in.
    adminAvailable: adminExists === false && user !== null && user !== undefined,
    claim,
  };
}
