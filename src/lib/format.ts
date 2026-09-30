/** Formatting helpers for ledger amounts and dates. */

/** Format cents as a signed USD amount, e.g. 125000 → "$1,250.00". */
export function formatCentavos(amount: number): string {
  const abs = (Math.abs(amount) / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${amount < 0 ? "−" : ""}$${abs}`;
}

/** Short date for table columns, e.g. "Sep 29". */
export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
  });
}

/** Full date-time for detail views. */
export function formatDateTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Relative time for comment threads. */
export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(timestamp);
}

/** Initials for avatar circles. */
export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return (
    parts.map((p) => p[0]?.toUpperCase() ?? "").join("") ||
    name[0].toUpperCase()
  );
}

/** Editorial status pill styles (solid backgrounds like the reference app). */
export const STATUS_STYLES: Record<string, string> = {
  pending: "bg-[#8a8578] text-[#fdfcf9]",
  approved: "bg-[#2e5c4d] text-[#fdfcf9]",
  rejected: "bg-[#9c3d31] text-[#fdfcf9]",
};

/** Small dot colors per status for list markers. */
export const STATUS_DOTS: Record<string, string> = {
  pending: "bg-[#8a8578]",
  approved: "bg-[#2e5c4d]",
  rejected: "bg-[#9c3d31]",
};

/** A green amount is money in; a red amount is money out. */
export const amountTone = (amount: number) =>
  amount >= 0 ? "text-[#2e5c4d]" : "text-[#9c3d31]";
