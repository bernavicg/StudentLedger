import { makeFunctionReference } from "convex/server";
import type { DefaultFunctionArgs } from "convex/server";

/**
 * Small typed wrapper around makeFunctionReference for internal queries.
 * Keeps call sites in node actions readable (sheets.ts uses the same
 * inline makeFunctionReference pattern).
 */
export function internalQueryReference<Args extends DefaultFunctionArgs, Result>(name: string) {
  return makeFunctionReference<"query", Args, Result>(name);
}
