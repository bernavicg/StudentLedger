import { Wordmark } from "@/components/Wordmark";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/hooks/use-auth";
import { useSheetsAutoSync } from "@/hooks/use-sheets-auto-sync";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ClipboardCheck,
  FileText,
  GraduationCap,
  ListTodo,
  Receipt,
  ScanSearch,
  Sheet,
  Sparkles,
  Store,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function AppShell({
  children,
  active,
}: {
  children: ReactNode;
  active:
    | "tasks"
    | "entries"
    | "invoices"
    | "students"
    | "providers"
    | "approvals"
    | "sheets"
    | "docs"
    | "import"
    | "assistant"
    | "admin";
}) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "admin";

  // Keeps the Google Sheet fresh for admins without a server cron.
  useSheetsAutoSync();

  const handleSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-border bg-sidebar sm:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <img
            src="/logo.svg"
            alt=""
            width={36}
            height={36}
            className="rounded-lg"
          />
          <div className="min-w-0">
            <p className="font-serif text-lg font-semibold leading-tight">
              Ledger
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Internal · {user?.name ? `${user.name}'s team` : "team workspace"}
            </p>
          </div>
        </div>

        <nav className="mt-2 flex flex-col gap-0.5 px-3">
          <Link
            to="/dashboard"
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active === "tasks"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <ListTodo className="size-4" />
            Tasks
          </Link>
          <Link
            to="/entries"
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active === "entries"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Receipt className="size-4" />
            Entries
          </Link>
          <Link
            to="/invoices"
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active === "invoices"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <FileText className="size-4" />
            Invoices
          </Link>
          <Link
            to="/students"
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active === "students"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <GraduationCap className="size-4" />
            Students
          </Link>
          <Link
            to="/providers"
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active === "providers"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Store className="size-4" />
            Providers
          </Link>
          {isAdmin && (
            <Link
              to="/approvals"
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                active === "approvals"
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <ClipboardCheck className="size-4" />
              Approvals
            </Link>
          )}
          <Link
            to="/sheets"
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active === "sheets"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Sheet className="size-4" />
            Sheets
          </Link>
          {isAdmin && (
            <Link
              to="/docs"
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                active === "docs"
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <ScanSearch className="size-4" />
              Docs
            </Link>
          )}
          {isAdmin && (
            <Link
              to="/import"
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                active === "import"
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <Users className="size-4" />
              Import students
            </Link>
          )}
          <Link
            to="/assistant"
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active === "assistant"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
            )}
          >
            <Sparkles className="size-4" />
            AI Assistant
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                active === "admin"
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
              )}
            >
              <Sparkles className="size-4" />
              Admin
            </Link>
          )}
        </nav>

        <div className="mt-auto p-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors hover:bg-accent"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="bg-primary font-serif text-xs text-primary-foreground">
                    {initials(user?.name ?? user?.email)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {user?.name || "Signed in"}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {user?.email}
                  </span>
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-52">
              <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Mobile top bar: wordmark + nav links + avatar menu */}
      <div className="fixed inset-x-0 top-0 z-30 border-b border-border bg-sidebar sm:hidden">
        <div className="flex items-center justify-between px-4 py-2.5">
          <Wordmark size={28} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Avatar className="size-8 cursor-pointer">
                <AvatarFallback className="bg-primary font-serif text-xs text-primary-foreground">
                  {initials(user?.name ?? user?.email)}
                </AvatarFallback>
              </Avatar>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer">
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {/* Scrollable nav strip so every page is reachable on phones */}
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2">
          <Link
            to="/dashboard"
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
              active === "tasks"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <ListTodo className="size-3.5" />
            Tasks
          </Link>
          <Link
            to="/entries"
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
              active === "entries"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <Receipt className="size-3.5" />
            Entries
          </Link>
          <Link
            to="/invoices"
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
              active === "invoices"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <FileText className="size-3.5" />
            Invoices
          </Link>
          <Link
            to="/students"
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
              active === "students"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <GraduationCap className="size-3.5" />
            Students
          </Link>
          <Link
            to="/providers"
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
              active === "providers"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <Store className="size-3.5" />
            Providers
          </Link>
          {isAdmin && (
            <Link
              to="/approvals"
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
                active === "approvals"
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              <ClipboardCheck className="size-3.5" />
              Approvals
            </Link>
          )}
          <Link
            to="/sheets"
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
              active === "sheets"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <Sheet className="size-3.5" />
            Sheets
          </Link>
          {isAdmin && (
            <Link
              to="/docs"
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
                active === "docs"
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              <ScanSearch className="size-3.5" />
              Docs
            </Link>
          )}
          {isAdmin && (
            <Link
              to="/import"
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
                active === "import"
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              <Users className="size-3.5" />
              Import
            </Link>
          )}
          <Link
            to="/assistant"
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
              active === "assistant"
                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                : "text-muted-foreground",
            )}
          >
            <Sparkles className="size-3.5" />
            AI
          </Link>
          {isAdmin && (
            <Link
              to="/admin"
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors",
                active === "admin"
                  ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                  : "text-muted-foreground",
              )}
            >
              <Sparkles className="size-3.5" />
              Admin
            </Link>
          )}
        </nav>
      </div>

      {/* Main (offset for the fixed mobile top bar, sidebar on desktop) */}
      <main className="min-w-0 flex-1 pt-[104px] pb-16 sm:ml-60 sm:pt-0 sm:pb-0">{children}</main>
    </div>
  );
}
