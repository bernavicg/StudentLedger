import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { formatCentavos, initials } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  MoreHorizontal,
  Search,
  ShieldCheck,
  UserMinus,
  UserRoundCheck,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type TeamMember = {
  _id: Id<"users">;
  name?: string;
  email?: string;
  role?: "admin" | "member" | "user";
  isAnonymous?: boolean;
};

export default function Admin() {
  const team = useQuery(api.users.listTeam);
  const entries = useQuery(api.entries.list, {
    paginationOpts: { numItems: 500, cursor: null },
  });
  const setUserRole = useMutation(api.users.setUserRole);
  const removeFromTeam = useMutation(api.users.removeFromTeam);

  const [search, setSearch] = useState("");
  const [roleChange, setRoleChange] = useState<TeamMember | null>(null);
  const [pendingRole, setPendingRole] = useState<"admin" | "member" | "user">(
    "member",
  );
  const [confirmRemove, setConfirmRemove] = useState<TeamMember | null>(null);

  const members = useMemo(() => {
    if (!team) return [];
    const query = search.trim().toLowerCase();
    return team
      .filter(
        (member) =>
          !query ||
          member.name?.toLowerCase().includes(query) ||
          member.email?.toLowerCase().includes(query),
      )
      .sort((a, b) =>
        (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? ""),
      );
  }, [team, search]);

  // Per-member activity rollup from the recent entries page.
  const stats = useMemo(() => {
    const map = new Map<string, { filed: number; pending: number }>();
    for (const entry of entries?.page ?? []) {
      const current = map.get(entry.createdBy) ?? { filed: 0, pending: 0 };
      current.filed += 1;
      if (entry.status === "pending") current.pending += 1;
      map.set(entry.createdBy, current);
    }
    return map;
  }, [entries]);

  if (team === undefined) {
    return (
      <AppShell active="admin">
        <div className="mx-auto w-full max-w-4xl px-6 py-10">
          <Skeleton className="h-9 w-48" />
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton key={index} className="h-20 rounded-2xl" />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  if (team === null) {
    return (
      <AppShell active="admin">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center px-6 py-24 text-center">
          <ShieldCheck className="size-8 text-muted-foreground/50" />
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            admin access required
          </p>
          <h1 className="mt-2 font-serif text-2xl font-semibold">
            This area is restricted to team admins.
          </h1>
          <Button asChild variant="outline" className="mt-6 rounded-full">
            <Link to="/dashboard">Back to your ledger</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const handleRoleChange = async () => {
    if (!roleChange) return;
    try {
      await setUserRole({ userId: roleChange._id, role: pendingRole });
      toast.success(
        `${roleChange.name || roleChange.email || "Member"} is now ${
          pendingRole === "admin" ? "an admin" : `a ${pendingRole}`
        }.`,
      );
      setRoleChange(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Role change failed.",
      );
    }
  };

  const handleRemove = async () => {
    if (!confirmRemove) return;
    try {
      await removeFromTeam({ userId: confirmRemove._id });
      toast.success(
        `${confirmRemove.name || confirmRemove.email || "Member"} removed. Their entries stay on the record.`,
      );
      setConfirmRemove(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Removal failed.");
    }
  };

  return (
    <AppShell active="admin">
      <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:py-10">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Admin
        </p>
        <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
          Team &amp; ledger control
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Manage who's on the team and keep watch over the whole ledger.
        </p>

        {/* Ledger-wide stats */}
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          {[
            {
              label: "Team members",
              value: String(team.filter((m) => !m.isAnonymous).length),
            },
            {
              label: "Pending review",
              value: String(
                (entries?.page ?? []).filter((e) => e.status === "pending")
                  .length,
              ),
            },
            {
              label: "Filed (recent)",
              value: String(entries?.page.length ?? 0),
            },
            {
              label: "Approved net",
              value: formatCentavos(
                (entries?.page ?? [])
                  .filter((e) => e.status === "approved")
                  .reduce((sum, e) => sum + e.amount, 0),
              ),
            },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-2xl border border-border bg-card px-5 py-4"
            >
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {label}
              </p>
              <p className="mt-1 truncate font-serif text-2xl font-semibold">
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Recent entries across the team */}
        <Card className="mt-6 rounded-2xl border-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-3 font-serif text-xl">
              <span>Recent entries — all members</span>
              <span className="font-sans text-xs font-normal text-muted-foreground">
                showing {entries?.page.length ?? 0}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(entries?.page.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing has been filed yet.
              </p>
            ) : (
              <div className="scrollbar-thin max-h-72 overflow-y-auto">
                <ul className="divide-y divide-border">
                  {(entries?.page ?? []).slice(0, 50).map((entry) => (
                    <li key={entry._id}>
                      <Link
                        to={`/entries/${entry._id}`}
                        className="flex items-center gap-4 py-3 transition-colors hover:bg-accent/50"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium hover:text-primary">
                            {entry.title}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {entry.authorName} · {entry.category ?? "uncategorized"}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "hidden whitespace-nowrap text-sm font-medium sm:block",
                            entry.amount >= 0
                              ? "text-[#2e5c4d]"
                              : "text-[#9c3d31]",
                          )}
                        >
                          {formatCentavos(entry.amount)}
                        </span>
                        <span className="w-20 text-right text-xs text-muted-foreground">
                          {entry.status}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Team roster */}
        <Card className="mt-6 rounded-2xl border-border shadow-none">
          <CardHeader className="pb-3">
            <CardTitle className="flex flex-wrap items-center justify-between gap-3 font-serif text-xl">
              <span className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                Team roster
              </span>
              <div className="relative">
                <Search className="absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or email…"
                  className="h-8 w-56 pl-9 text-xs"
                />
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y divide-border">
            {members.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                No members match that search.
              </p>
            )}
            {members.map((member) => {
              const stat = stats.get(member._id);
              return (
                <div
                  key={member._id}
                  className="flex flex-wrap items-center gap-3 py-3"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary font-serif text-xs text-primary-foreground">
                    {initials(member.name ?? member.email)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {member.name || "Unnamed member"}
                      {member.isAnonymous && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          removed
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {member.email ?? "no email"}
                    </p>
                  </div>
                  <div className="hidden text-right text-xs text-muted-foreground sm:block">
                    <p>{stat?.filed ?? 0} filed</p>
                    <p>{stat?.pending ?? 0} pending</p>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium",
                      member.role === "admin"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {member.role ?? "user"}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-muted-foreground"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      <DropdownMenuItem
                        className="cursor-pointer"
                        onClick={() => {
                          setRoleChange(member);
                          setPendingRole(
                            member.role === "admin" ? "member" : "admin",
                          );
                        }}
                      >
                        {member.role === "admin" ? (
                          <>
                            <UserRoundCheck className="mr-2 size-4" />
                            Change to member
                          </>
                        ) : (
                          <>
                            <ShieldCheck className="mr-2 size-4" />
                            Make admin
                          </>
                        )}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="cursor-pointer text-destructive focus:text-destructive"
                        onClick={() => setConfirmRemove(member)}
                      >
                        <UserMinus className="mr-2 size-4" />
                        Remove from team
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* Role change confirmation */}
      <Dialog
        open={roleChange !== null}
        onOpenChange={(open) => !open && setRoleChange(null)}
      >
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              {pendingRole === "admin" ? "Grant admin access?" : "Change role"}
            </DialogTitle>
            <DialogDescription>
              {roleChange?.name || roleChange?.email} will become{" "}
              {pendingRole === "admin"
                ? "an admin: they can settle any entry and manage the team."
                : `a ${pendingRole}: they can file entries and manage only their own.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRoleChange(null)}>
              Cancel
            </Button>
            <Button className="rounded-full" onClick={handleRoleChange}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove confirmation */}
      <Dialog
        open={confirmRemove !== null}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
      >
        <DialogContent className="rounded-2xl sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              Remove this member?
            </DialogTitle>
            <DialogDescription>
              {confirmRemove?.name || confirmRemove?.email} will lose access
              immediately. Their filed entries and messages stay on the record.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmRemove(null)}>
              Cancel
            </Button>
            <Button variant="destructive" className="rounded-full" onClick={handleRemove}>
              Remove member
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
