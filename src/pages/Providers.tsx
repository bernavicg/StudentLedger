import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "convex/react";
import { Building2, Hash, Plus, Store, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

type ProviderRow = {
  _id: Id<"providers">;
  name: string;
  contact: string | null;
  ssid: string | null;
  notes: string | null;
};

export default function Providers() {
  const providers = useQuery(api.providers.list);
  const createProvider = useMutation(api.providers.create);
  const removeProvider = useMutation(api.providers.remove);

  const [search, setSearch] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<Id<"providers"> | null>(null);
  const [deleteId, setDeleteId] = useState<Id<"providers"> | null>(null);

  const updateProvider = useMutation(api.providers.update);

  const editing = providers?.find((p) => p._id === editId) ?? null;

  const handleUpdate = async (values: {
    name: string;
    contact?: string;
    ssid?: string;
    notes?: string;
  }) => {
    if (editId === null) return;
    try {
      await updateProvider({ providerId: editId, ...values });
      toast.success("Provider updated.");
      setEditId(null);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update provider.",
      );
    }
  };

  const { user } = useAuth();

  const visible = useMemo(() => {
    if (!providers) return [];
    const query = search.trim().toLowerCase();
    return query
      ? providers.filter(
          (p) =>
            p.name.toLowerCase().includes(query) ||
            p.contact?.toLowerCase().includes(query) ||
            p.ssid?.toLowerCase().includes(query),
        )
      : providers;
  }, [providers, search]);

  const handleDelete = async (provider: ProviderRow) => {
    try {
      await removeProvider({ providerId: provider._id });
      toast.success("Provider deleted. Ledger entries keep the name as history.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not delete provider.",
      );
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <AppShell active="providers">
      <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:py-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Providers
            </p>
            <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight sm:text-4xl">
              Service providers
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              {providers === undefined
                ? "Loading…"
                : providers.length === 0
                  ? "No providers yet — add the first one below"
                  : `${providers.length} provider${providers.length === 1 ? "" : "s"} on file`}
            </p>
          </div>
          {providers !== undefined && (
            <AddProviderDialog
              open={editOpen}
              onOpenChange={setEditOpen}
              onCreate={createProvider}
            />
          )}
        </div>

        {/* Search */}
        {providers !== undefined && providers.length > 0 && (
          <div className="relative mt-6">
            <Store className="absolute left-3.5 top-3 size-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search providers…"
              className="pl-10"
            />
          </div>
        )}

        {/* Roster */}
        {providers === undefined ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-36 rounded-2xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="mt-4 flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-16 text-center">
            <Building2 className="size-8 text-muted-foreground/50" />
            <p className="mt-3 font-serif text-lg font-semibold">
              {providers.length === 0
                ? "No providers on file yet"
                : "No providers match that search"}
            </p>
            {providers.length === 0 && (
              <>
                <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                  Add the tutoring centers or schools your students pay, then
                  pick them from the ledger entry form.
                </p>
                <Button
                  className="mt-5 rounded-full"
                  onClick={() => setEditOpen(true)}
                >
                  <UserPlus className="mr-2 size-4" />
                  Add provider
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {visible.map((provider) => (
              <div
                key={provider._id}
                className="flex flex-col rounded-2xl border border-border bg-card p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-serif text-lg font-semibold">
                      {provider.name}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {provider.contact ?? "no contact"}
                    </p>
                    {provider.ssid && (
                      <p className="mt-1 flex items-center gap-1 truncate text-xs text-muted-foreground">
                        <Hash className="size-3 shrink-0" />
                        <span className="truncate">
                          Acct {provider.ssid}
                        </span>
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-[#2e5c4d] px-3 py-1 text-xs font-medium text-[#fdfcf9]">
                    provider
                  </span>
                </div>
                {provider.notes && (
                  <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">
                    {provider.notes}
                  </p>
                )}
                {user?.role === "admin" && (
                  <div className="mt-4 flex justify-end gap-1 border-t border-border pt-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-xs text-muted-foreground"
                      onClick={() => setEditId(provider._id)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full text-xs text-muted-foreground hover:text-destructive"
                      onClick={() => setDeleteId(provider._id)}
                    >
                      Delete
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Edit provider */}
        {editing && (
          <EditProviderDialog
            provider={editing}
            onOpenChange={(open) => !open && setEditId(null)}
            onUpdate={handleUpdate}
          />
        )}

        {/* Delete confirm */}
        <Dialog
          open={deleteId !== null}
          onOpenChange={(open) => !open && setDeleteId(null)}
        >
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-serif text-xl">
                Delete provider?
              </DialogTitle>
              <DialogDescription>
                Ledger entries that used this name keep it as history. This
                cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeleteId(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const provider = providers?.find((p) => p._id === deleteId);
                  if (provider) void handleDelete(provider);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

/** Edit-provider dialog, for changing an existing name/account no./contact. */
function EditProviderDialog({
  provider,
  onOpenChange,
  onUpdate,
}: {
  provider: ProviderRow;
  onOpenChange: (open: boolean) => void;
  onUpdate: (values: {
    name: string;
    contact?: string;
    ssid?: string;
    notes?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(provider.name);
  const [contact, setContact] = useState(provider.contact ?? "");
  const [ssid, setSsid] = useState(provider.ssid ?? "");
  const [notes, setNotes] = useState(provider.notes ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Give the provider a name.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onUpdate({
        name,
        contact: contact || undefined,
        ssid: ssid || undefined,
        notes: notes || undefined,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Edit provider</DialogTitle>
          <DialogDescription>
            Update the name, account number, or contact details.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-provider-name">Name</Label>
            <Input
              id="edit-provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-provider-ssid">
              Account number{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="edit-provider-ssid"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder="e.g. 1234-5678-90"
              inputMode="numeric"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-provider-contact">
              Contact <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="edit-provider-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Phone or email"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-provider-notes">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="edit-provider-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering."
              className="min-h-20"
              disabled={isSubmitting}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AddProviderDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: ReturnType<typeof useMutation<typeof api.providers.create>>;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [ssid, setSsid] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const reset = () => {
    setName("");
    setContact("");
    setSsid("");
    setNotes("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      toast.error("Give the provider a name.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onCreate({
        name,
        contact: contact || undefined,
        ssid: ssid || undefined,
        notes: notes || undefined,
      });
      toast.success("Provider added.");
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not add provider.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button className="rounded-full">
          <Plus className="mr-2 size-4" />
          Add provider
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">Add provider</DialogTitle>
          <DialogDescription>
            The tutoring center or school a student paid. Ledger entries will
            pick from this list.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="provider-name">Name</Label>
            <Input
              id="provider-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bright Minds Tutoring"
              required
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-contact">
              Contact <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="provider-contact"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Phone or email"
              disabled={isSubmitting}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-ssid">
              Account number{" "}
              <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="provider-ssid"
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
              placeholder="e.g. 1234-5678-90"
              inputMode="numeric"
              disabled={isSubmitting}
            />
            <p className="text-[11px] text-muted-foreground">
              The account number you have with this provider.
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="provider-notes">
              Notes <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="provider-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering."
              className="min-h-20"
              disabled={isSubmitting}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Adding…" : "Add provider"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
