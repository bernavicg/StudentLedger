import { describe, expect, test } from "bun:test";
import {
  formatBytes,
  invoiceExtension,
  invoiceViewerUrl,
  isInvoiceExtension,
  isNativelyViewable,
  resolveInvoiceMimeType,
} from "../src/lib/invoices";

describe("invoiceExtension", () => {
  test("returns the lowercase extension without the dot", () => {
    expect(invoiceExtension("Paper Invoice.PDF")).toBe("pdf");
    expect(invoiceExtension("polaris-billing.docx")).toBe("docx");
  });

  test("returns an empty string without an extension", () => {
    expect(invoiceExtension("invoice")).toBe("");
  });
});

describe("isInvoiceExtension", () => {
  test("accepts pdf, doc, and docx only", () => {
    expect(isInvoiceExtension("a.pdf")).toBe(true);
    expect(isInvoiceExtension("a.doc")).toBe(true);
    expect(isInvoiceExtension("a.docx")).toBe(true);
    expect(isInvoiceExtension("a.png")).toBe(false);
    expect(isInvoiceExtension("a.exe")).toBe(false);
  });
});

describe("resolveInvoiceMimeType", () => {
  test("trusts a supported browser type", () => {
    expect(
      resolveInvoiceMimeType("a.pdf", "application/pdf"),
    ).toBe("application/pdf");
  });

  test("falls back to the extension for empty or odd browser types", () => {
    expect(resolveInvoiceMimeType("a.docx", "")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(
      resolveInvoiceMimeType("a.doc", "application/x-unknown"),
    ).toBe("application/msword");
  });

  test("rejects unsupported files", () => {
    expect(resolveInvoiceMimeType("a.png", "image/png")).toBe(null);
    expect(resolveInvoiceMimeType("a.exe", "")).toBe(null);
  });
});

describe("viewer URLs", () => {
  test("PDFs use the file URL directly", () => {
    expect(
      isNativelyViewable("application/pdf"),
    ).toBe(true);
    expect(
      invoiceViewerUrl("https://x.example/a.pdf", "application/pdf"),
    ).toBe("https://x.example/a.pdf");
  });

  test("Word docs go through Google's public viewer", () => {
    expect(isNativelyViewable("application/msword")).toBe(false);
    expect(
      invoiceViewerUrl("https://x.example/a.doc", "application/msword"),
    ).toBe(
      "https://docs.google.com/viewer?url=" +
        encodeURIComponent("https://x.example/a.doc") +
        "&embedded=true",
    );
  });
});

describe("formatBytes", () => {
  test("formats bytes, KB, and MB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1536 * 1024)).toBe("1.5 MB");
  });
});
