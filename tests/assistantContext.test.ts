import { describe, expect, test } from "bun:test";
import {
  money,
  studentLabelFor,
  summarizeEntries,
  summarizeInvoices,
  summarizeTasks,
  type EntryRow,
  type InvoiceRow,
  type TaskRow,
} from "../src/convex/lib/assistantContext";

describe("studentLabelFor", () => {
  test("appends the case number when present", () => {
    expect(studentLabelFor({ name: "Mira Chen", caseNo: "CASE-2026-014" })).toBe(
      "Mira Chen (case CASE-2026-014)",
    );
  });

  test("returns the plain name without a case number", () => {
    expect(studentLabelFor({ name: "Mira Chen" })).toBe("Mira Chen");
    expect(studentLabelFor({ name: "Mira Chen", caseNo: null })).toBe(
      "Mira Chen",
    );
  });
});

describe("money", () => {
  test("formats signed centavos", () => {
    expect(money(125000)).toBe("$1,250.00");
    expect(money(-125000)).toBe("-$1,250.00");
    expect(money(-50)).toBe("-$0.50");
  });
});

describe("summarizeEntries", () => {
  const stats = { pending: 2, approvedCount: 1, netApproved: -5000 };
  const entries: EntryRow[] = [
    {
      title: "Paper Invoice",
      amount: -5000,
      status: "pending",
      category: "operations",
      studentName: "Mira Chen",
      createdAt: Date.UTC(2026, 9, 6),
    },
  ];

  test("includes totals and the entry line", () => {
    const text = summarizeEntries(stats, entries);
    expect(text).toContain("2 pending review");
    expect(text).toContain("net approved -$50.00");
    expect(text).toContain("Paper Invoice -$50.00 (pending, operations, student Mira Chen)");
  });

  test("says when the ledger is empty", () => {
    expect(summarizeEntries(stats, [])).toContain("No ledger entries");
  });
});

describe("summarizeTasks", () => {
  const tasks: TaskRow[] = [
    {
      title: "Follow up on Polaris billing",
      status: "in_progress",
      due: "2026-10-01",
      createdAt: Date.UTC(2026, 9, 1),
      creatorName: "Berna",
    },
    {
      title: "File September receipts",
      status: "done",
      due: null,
      createdAt: Date.UTC(2026, 9, 2),
      creatorName: "Berna",
    },
  ];

  test("lists open tasks with overdue flags and skips done ones", () => {
    const text = summarizeTasks(tasks);
    expect(text).toContain("0 to do, 1 in progress, 1 done");
    expect(text).toContain("[in progress] Follow up on Polaris billing");
    expect(text).toContain("due 2026-10-01 — OVERDUE");
    expect(text).not.toContain("File September receipts");
  });

  test("says when the board is empty", () => {
    expect(summarizeTasks([])).toContain("No tasks on the board yet.");
  });
});

describe("summarizeInvoices", () => {
  const invoices: InvoiceRow[] = [
    {
      title: "Paper Invoice — September",
      studentName: "Mira Chen",
      fileName: "invoice.pdf",
      caseNo: "CASE-2026-014",
      createdAt: Date.UTC(2026, 9, 6),
    },
  ];

  test("lists invoices with student and case number", () => {
    const text = summarizeInvoices(invoices);
    expect(text).toContain("1 paper invoices on file");
    expect(text).toContain("student Mira Chen (case CASE-2026-014)");
    expect(text).toContain("file invoice.pdf");
  });

  test("says when there are no invoices", () => {
    expect(summarizeInvoices([])).toContain("No paper invoices");
  });
});
