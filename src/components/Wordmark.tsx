import logo from "@/assets/logo.svg";
import { cn } from "@/lib/utils";
import { Link } from "react-router";

export function Wordmark({
  size = 32,
  showText = true,
  className,
}: {
  size?: number;
  showText?: boolean;
  className?: string;
}) {
  return (
    <Link
      to="/"
      className={cn("flex items-center gap-2.5 rounded-md", className)}
    >
      <img
        src={logo}
        alt="Ledger"
        width={size}
        height={size}
        className="rounded-lg"
      />
      {showText && (
        <span className="font-serif text-lg font-semibold tracking-tight text-foreground">
          Ledger
        </span>
      )}
    </Link>
  );
}
