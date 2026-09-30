/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appSettings from "../appSettings.js";
import type * as approvals from "../approvals.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as entries from "../entries.js";
import type * as http from "../http.js";
import type * as legacyImport from "../legacyImport.js";
import type * as legacyImportStore from "../legacyImportStore.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_fingerprint from "../lib/fingerprint.js";
import type * as lib_namesMatch from "../lib/namesMatch.js";
import type * as lib_settingsRow from "../lib/settingsRow.js";
import type * as lib_sheetId from "../lib/sheetId.js";
import type * as lib_sheetRows from "../lib/sheetRows.js";
import type * as lib_sieve from "../lib/sieve.js";
import type * as providers from "../providers.js";
import type * as sheets from "../sheets.js";
import type * as sheetsInternal from "../sheetsInternal.js";
import type * as sheetsNode from "../sheetsNode.js";
import type * as sheetsPicker from "../sheetsPicker.js";
import type * as sieve from "../sieve.js";
import type * as sieveInternal from "../sieveInternal.js";
import type * as sieveNode from "../sieveNode.js";
import type * as students from "../students.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appSettings: typeof appSettings;
  approvals: typeof approvals;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  entries: typeof entries;
  http: typeof http;
  legacyImport: typeof legacyImport;
  legacyImportStore: typeof legacyImportStore;
  "lib/auth": typeof lib_auth;
  "lib/fingerprint": typeof lib_fingerprint;
  "lib/namesMatch": typeof lib_namesMatch;
  "lib/settingsRow": typeof lib_settingsRow;
  "lib/sheetId": typeof lib_sheetId;
  "lib/sheetRows": typeof lib_sheetRows;
  "lib/sieve": typeof lib_sieve;
  providers: typeof providers;
  sheets: typeof sheets;
  sheetsInternal: typeof sheetsInternal;
  sheetsNode: typeof sheetsNode;
  sheetsPicker: typeof sheetsPicker;
  sieve: typeof sieve;
  sieveInternal: typeof sieveInternal;
  sieveNode: typeof sieveNode;
  students: typeof students;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
