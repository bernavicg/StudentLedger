/** Shared helpers for the Paper Invoices page (types + viewer URLs). */

/** Extension → MIME type for the invoice formats we accept. */
export const INVOICE_MIME_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
} as const;

export type InvoiceExtension = keyof typeof INVOICE_MIME_TYPES;

/** Lowercase extension of a file name, without the dot. */
export function invoiceExtension(fileName: string): string {
  const match = /\.([^.]+)$/.exec(fileName.trim());
  return match ? match[1].toLowerCase() : "";
}

/** Is this extension one of the invoice formats we accept? */
export function isInvoiceExtension(fileName: string): boolean {
  return invoiceExtension(fileName) in INVOICE_MIME_TYPES;
}

/**
 * Resolve the MIME type to store: trust the browser's type when it is one
 * we accept, otherwise fall back to the file extension. Returns null for
 * unsupported files.
 */
export function resolveInvoiceMimeType(
  fileName: string,
  browserType: string,
): string | null {
  if (isSupportedMimeType(browserType)) return browserType;
  const extension = invoiceExtension(fileName);
  if (extension === "pdf" || extension === "doc" || extension === "docx") {
    return INVOICE_MIME_TYPES[extension];
  }
  return null;
}

/** PDFs render natively in an iframe; Word docs need Google's viewer. */
export function isNativelyViewable(mimeType: string): boolean {
  return mimeType === "application/pdf";
}

/**
 * URL to embed for view-only reading: the file itself for PDFs, Google
 * Docs' public viewer for DOC/DOCX (the Convex storage URL is public).
 */
export function invoiceViewerUrl(url: string, mimeType: string): string {
  if (isNativelyViewable(mimeType)) return url;
  return `https://docs.google.com/viewer?url=${encodeURIComponent(url)}&embedded=true`;
}

/** "1.2 MB" style size label. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isSupportedMimeType(type: string): boolean {
  return Object.values(INVOICE_MIME_TYPES).includes(
    type as (typeof INVOICE_MIME_TYPES)[InvoiceExtension],
  );
}
