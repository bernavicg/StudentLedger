import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireAdmin, requireUser } from "./lib/auth";

/** MIME types accepted for invoice uploads (PDF and Word docs). */
const SUPPORTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** Short-lived, single-use upload URL for one invoice file. Admin only. */
export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * Record an uploaded file as a student's invoice. Admin only. Called after
 * the browser POSTs the file to generateUploadUrl; orphans (unsupported
 * types, zero-byte files) are cleaned up instead of kept.
 */
export const save = mutation({
  args: {
    storageId: v.id("_storage"),
    studentId: v.id("students"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.number(),
    title: v.optional(v.string()),
    caseNo: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const admin = await requireAdmin(ctx);

    const student = await ctx.db.get(args.studentId);
    if (!student) throw new Error("Pick a student for this invoice.");
    if (!SUPPORTED_MIME_TYPES.has(args.mimeType)) {
      await ctx.storage.delete(args.storageId);
      throw new Error("Only PDF, DOC, and DOCX files are supported.");
    }
    if (args.sizeBytes <= 0) {
      await ctx.storage.delete(args.storageId);
      throw new Error("That file looks empty.");
    }

    const trimmedName = args.fileName.trim() || "invoice";

    // Billing snapshot auto-computed from the student's plan at upload time.
    const totalSessions = student.totalSessions;
    const totalHours =
      student.authorizedMinutes !== undefined
        ? (student.totalSessions * student.authorizedMinutes) / 60
        : undefined;
    const totalAmountCents =
      student.ratePerSessionCents !== undefined
        ? student.totalSessions * student.ratePerSessionCents
        : undefined;

    return await ctx.db.insert("invoices", {
      studentId: args.studentId,
      title: args.title?.trim() || trimmedName.replace(/\.[^.]+$/, ""),
      caseNo: args.caseNo?.trim() || undefined,
      fileName: trimmedName,
      fileId: args.storageId,
      mimeType: args.mimeType,
      sizeBytes: args.sizeBytes,
      totalSessions,
      totalHours,
      totalAmountCents,
      createdBy: admin.userId,
      createdAt: Date.now(),
    });
  },
});

/**
 * Every invoice, newest first, with the student, uploader, and a serving
 * URL for the embedded viewer. Visible to every signed-in member.
 */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const [invoices, students, users] = await Promise.all([
      ctx.db.query("invoices").order("desc").collect(),
      ctx.db.query("students").collect(),
      ctx.db.query("users").collect(),
    ]);
    const studentNames = new Map(students.map((s) => [s._id, s.name]));
    const userNames = new Map(
      users.map((u) => [u._id, u.name ?? u.email ?? "Unknown"]),
    );
    const rows = [];
    for (const invoice of invoices) {
      const url = await ctx.storage.getUrl(invoice.fileId);
      rows.push({
        _id: invoice._id,
        title: invoice.title,
        studentId: invoice.studentId,
        studentName: studentNames.get(invoice.studentId) ?? "Unknown student",
        caseNo: invoice.caseNo,
        fileName: invoice.fileName,
        totalSessions: invoice.totalSessions,
        totalHours: invoice.totalHours ?? null,
        totalAmountCents: invoice.totalAmountCents ?? null,
        mimeType: invoice.mimeType,
        sizeBytes: invoice.sizeBytes,
        url: url ?? undefined,
        createdAt: invoice.createdAt,
        createdBy: invoice.createdBy,
        uploaderName: userNames.get(invoice.createdBy) ?? "Unknown",
      });
    }
    return rows;
  },
});

/**
 * Correct an invoice's billing snapshot (admin only). Upload auto-fills
 * totals from the student's plan, but the PDF itself is the source of
 * truth — this lets an admin fix the numbers to match the document.
 */
export const updateTotals = mutation({
  args: {
    invoiceId: v.id("invoices"),
    totalSessions: v.number(),
    totalHours: v.optional(v.number()),
    totalAmountCents: v.optional(v.number()),
  },
  handler: async (ctx, { invoiceId, totalSessions, totalHours, totalAmountCents }) => {
    await requireAdmin(ctx);
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    if (!Number.isFinite(totalSessions) || totalSessions < 0) {
      throw new Error("Sessions must be zero or more.");
    }
    await ctx.db.patch(invoiceId, {
      totalSessions,
      totalHours: totalHours !== undefined && totalHours >= 0 ? totalHours : undefined,
      totalAmountCents:
        totalAmountCents !== undefined && totalAmountCents >= 0
          ? totalAmountCents
          : undefined,
    });
  },
});

/** Delete one invoice and its stored file. Admin only. */
export const remove = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    await requireAdmin(ctx);
    const invoice = await ctx.db.get(invoiceId);
    if (!invoice) throw new Error("Invoice not found.");
    await ctx.storage.delete(invoice.fileId);
    await ctx.db.delete(invoiceId);
  },
});
