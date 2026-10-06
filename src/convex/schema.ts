import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    })
      .index("email", ["email"]) // index for the email. do not remove or modify
      .index("by_role", ["role"]),

    // A single ledger entry: one line of money in or out, with a status.
    // For student charges: amount > 0 = what the student owes/paid; the
    // provider is who the student originally paid the (higher) amount to.
    entries: defineTable({
      title: v.string(),
      description: v.optional(v.string()),
      amount: v.number(), // stored as a signed number of centavos: negative for money out
      status: v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("rejected"),
      ),
      category: v.optional(v.string()),
      studentId: v.optional(v.id("students")),
      provider: v.optional(v.string()),
      paidAt: v.optional(v.number()), // when the student's payment was settled
      // Admin review outcome. A rejection always carries a note with the reason.
      reviewNote: v.optional(v.string()),
      reviewedBy: v.optional(v.id("users")),
      reviewedAt: v.optional(v.number()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_createdBy", ["createdBy"])
      .index("by_status", ["status"])
      .index("by_studentId", ["studentId"]),

    // A discussion message attached to one entry.
    comments: defineTable({
      entryId: v.id("entries"),
      authorId: v.id("users"),
      body: v.string(),
      createdAt: v.number(),
    }).index("by_entryId", ["entryId"]),

    // An enrolled student with their authorized service plan.
    // The max authorized amount is DERIVED, never stored:
    //   totalSessions × ratePerSessionCents
    // ratePerSessionCents is the per-session price; authorizedMinutes is the
    // length of each authorized session (30 or 60).
    students: defineTable({
      name: v.string(),
      contact: v.optional(v.string()),
      totalSessions: v.number(),
      ratePerSessionCents: v.optional(v.number()),
      authorizedMinutes: v.optional(v.union(v.literal(30), v.literal(60))),
      notes: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_createdBy", ["createdBy"]),

    // A service provider a student paid (tutoring center, school, etc.).
    // Ledger entries reference providers by name; the roster keeps them
    // consistent so the entry dialogs can offer a picker.
    providers: defineTable({
      name: v.string(),
      contact: v.optional(v.string()),
      ssid: v.optional(v.string()),
      notes: v.optional(v.string()),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    }).index("by_createdBy", ["createdBy"]),

    // One record per day a student attended. sessionsConsumed scales with
    // duration: a 60-minute mark against a 30-minute authorization costs 2.
    attendance: defineTable({
      studentId: v.id("students"),
      day: v.string(), // YYYY-MM-DD, chosen manually by the recording user
      startTime: v.optional(v.string()), // "HH:MM" 24h, 8:00am-8:45pm in 15-min steps
      endTime: v.optional(v.string()), // start + duration, computed on the server
      sessionNumber: v.number(), // first session index this mark consumed
      durationMinutes: v.optional(v.number()), // minutes the session ran
      sessionsConsumed: v.optional(v.number()), // defaults to 1 on old rows
      recordedBy: v.id("users"),
      createdAt: v.number(),
      // Admin review state. Absent on old rows, which are treated as pending.
      reviewStatus: v.optional(
        v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
      ),
      // Required when rejected: why the mark was turned down.
      reviewNote: v.optional(v.string()),
      reviewedBy: v.optional(v.id("users")),
      reviewedAt: v.optional(v.number()),
    })
      .index("by_studentId", ["studentId"])
      .index("by_studentId_day", ["studentId", "day"]),

    // One school-year Google Doc (September through June) shown in the
    // Docs page's live viewer. The doc keeps its own colors and formatting —
    // Google's preview endpoint renders it exactly as shared.
    gdocs: defineTable({
      label: v.string(), // e.g. "September" … "June"
      gdocId: v.string(), // bare document id from the /edit URL
      position: v.number(), // sort order (Sep=1 … Jun=10)
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_label", ["label"])
      .index("by_position", ["position"]),

    // One team to-do task shown on the task monitoring board (the dashboard).
    // Every signed-in member can create tasks and move them along
    // todo → in progress → done; only the creator or an admin can delete.
    tasks: defineTable({
      title: v.string(),
      notes: v.optional(v.string()),
      status: v.union(
        v.literal("todo"),
        v.literal("in_progress"),
        v.literal("done"),
      ),
      due: v.optional(v.string()), // YYYY-MM-DD, shown as a due-date pill
      completedAt: v.optional(v.number()), // set when status flips to done
      completedBy: v.optional(v.id("users")),
      createdBy: v.id("users"),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_status", ["status"])
      .index("by_createdBy", ["createdBy"]),

    // One paper invoice document (PDF or DOC) filed under a student.
    // The file bytes live in Convex file storage; this row keeps the
    // metadata. Admins upload and delete; every signed-in member views.
    invoices: defineTable({
      studentId: v.id("students"),
      title: v.string(), // human label, defaults to the file name
      fileName: v.string(),
      fileId: v.id("_storage"),
      mimeType: v.string(), // resolved on upload (pdf / doc / docx)
      sizeBytes: v.number(),
      createdBy: v.id("users"),
      createdAt: v.number(),
    })
      .index("by_studentId", ["studentId"])
      .index("by_createdBy", ["createdBy"]),

    // Singleton row tracking the Google Sheets mirror: when we last synced,
    // a fingerprint of the data we wrote, and the spreadsheet we target.
    // The fingerprint lets the scheduled sync skip work when nothing changed.
    appSettings: defineTable({
      key: v.string(), // always "main" — one settings row for the whole app
      lastSyncAt: v.optional(v.number()),
      lastFingerprint: v.optional(v.string()),
      lastError: v.optional(v.string()),
      lastSummary: v.optional(v.string()),
      // Spreadsheet we write the mirror into. Falls back to the
      // GOOGLE_SHEET_ID env var when unset.
      targetSheetId: v.optional(v.string()),
      // The spreadsheet the last sync actually wrote to (env-resolved).
      // Kept apart from targetSheetId so recording a sync can never overwrite
      // the admin's saved choice.
      lastSyncedSheetId: v.optional(v.string()),
      // Spreadsheet shown in the embedded viewer on the Sheets page.
      embedSheetId: v.optional(v.string()),
    }).index("by_key", ["key"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
