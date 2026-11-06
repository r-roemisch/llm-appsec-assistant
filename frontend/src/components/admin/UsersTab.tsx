import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { RoleBadge } from "@/components/common/ModelBadges";
import { LoadError, LoadingRows } from "@/components/common/QueryState";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentUser } from "@/hooks/useSession";
import { createUser, deleteUser, errorMessage, listUsers, resetUserPassword } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { queryKeys } from "@/lib/query-keys";
import type { Role, UserOut } from "@/lib/types";

function CreateUserForm() {
  const queryClient = useQueryClient();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createUser({ username: username.trim(), password, role }),
    onSuccess: (user) => {
      toast.success(`User ${user.username} created`);
      setUsername("");
      setPassword("");
      setRole("user");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">Create user</h3>
      <div className="space-y-2">
        <Label htmlFor="new-username">Username</Label>
        <Input
          id="new-username"
          required
          minLength={3}
          maxLength={64}
          pattern="[A-Za-z0-9._\-]+"
          autoComplete="off"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">3 to 64 characters: letters, digits, dots, underscores, hyphens.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-user-password">Password</Label>
        <Input
          id="new-user-password"
          type="password"
          required
          minLength={8}
          maxLength={256}
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="new-user-role">Role</Label>
        <Select value={role} onValueChange={(value) => setRole(value as Role)}>
          <SelectTrigger id="new-user-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="user">User</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={create.isPending}>
        {create.isPending ? "Creating" : "Create user"}
      </Button>
    </form>
  );
}

function ResetPasswordDialog({ user, open, onOpenChange }: { user: UserOut; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reset = useMutation({
    mutationFn: () => resetUserPassword(user.id, password),
    onSuccess: () => {
      toast.success(`Password reset for ${user.username}`);
      setPassword("");
      setError(null);
      onOpenChange(false);
    },
    onError: (err) => setError(errorMessage(err)),
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    reset.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Reset password for {user.username}</DialogTitle>
            <DialogDescription>The user signs in with the new password from now on.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`reset-password-${user.id}`}>New password</Label>
            <Input
              id={`reset-password-${user.id}`}
              type="password"
              required
              minLength={8}
              maxLength={256}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={reset.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={reset.isPending}>
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserRow({ user, isSelf }: { user: UserOut; isSelf: boolean }) {
  const queryClient = useQueryClient();
  const [resetting, setResetting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: () => deleteUser(user.id),
    onSuccess: () => {
      toast.success(`User ${user.username} deleted`);
      setConfirmingDelete(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers });
    },
    onError: (err) => setDeleteError(errorMessage(err)),
  });

  return (
    <TableRow>
      <TableCell className="font-medium">
        {user.username}
        {isSelf ? <span className="ml-1.5 text-xs text-muted-foreground">(you)</span> : null}
      </TableCell>
      <TableCell>
        <RoleBadge role={user.role} />
      </TableCell>
      <TableCell className="text-muted-foreground">{formatDateTime(user.created_at)}</TableCell>
      <TableCell className="text-right">
        <div className="flex justify-end gap-1.5">
          <Button variant="outline" size="sm" onClick={() => setResetting(true)}>
            Reset password
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              setDeleteError(null);
              setConfirmingDelete(true);
            }}
          >
            Delete
          </Button>
        </div>
        <ResetPasswordDialog user={user} open={resetting} onOpenChange={setResetting} />
        <ConfirmDialog
          open={confirmingDelete}
          onOpenChange={setConfirmingDelete}
          title={`Delete ${user.username}?`}
          description="Their account and all of their Conversations will be deleted. This cannot be undone."
          error={deleteError}
          confirmLabel="Delete user"
          destructive
          pending={remove.isPending}
          onConfirm={() => remove.mutate()}
        />
      </TableCell>
    </TableRow>
  );
}

export function UsersTab() {
  const me = useCurrentUser();
  const users = useQuery({ queryKey: queryKeys.adminUsers, queryFn: listUsers });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Users</h2>
        {users.isPending ? (
          <LoadingRows label="Loading users" />
        ) : users.isError ? (
          <LoadError error={users.error} onRetry={() => void users.refetch()} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.map((user) => (
                <UserRow key={user.id} user={user} isSelf={user.id === me.id} />
              ))}
            </TableBody>
          </Table>
        )}
      </section>
      <CreateUserForm />
    </div>
  );
}
