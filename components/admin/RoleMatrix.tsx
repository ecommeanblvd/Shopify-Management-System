'use client';

import { useState, useTransition } from 'react';
import { Lock, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { createRole, setRolePermissions, deleteRole } from '@/features/users/role-actions';
import type { ScopeDef } from '@/lib/auth/permissions';

// Column order for the matrix header — only render a cell if the scope has that action
const ACTION_ORDER = ['view', 'create', 'edit', 'delete', 'apply', 'push'] as const;
type ActionCol = (typeof ACTION_ORDER)[number];

const ACTION_LABELS: Record<ActionCol, string> = {
  view: 'Xem',
  create: 'Tạo',
  edit: 'Sửa',
  delete: 'Xoá',
  apply: 'Áp dụng',
  push: 'Đẩy',
};

interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissionKeys: string[];
}

interface Props {
  roles: RoleRow[];
  catalog: ScopeDef[];
  canEdit: boolean;
  canCreate: boolean;
  canDelete: boolean;
}

// ─── Single role card ─────────────────────────────────────────────────────────

function RoleCard({
  role,
  catalog,
  canEdit,
  canDelete,
}: {
  role: RoleRow;
  catalog: ScopeDef[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [localKeys, setLocalKeys] = useState<Set<string>>(() => new Set(role.permissionKeys));
  const [pending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  function toggle(scopeKey: string, action: string) {
    const perm = `${scopeKey}:${action}`;
    // Anti-lockout: admin's users_roles:edit is always checked
    if (role.key === 'admin' && perm === 'users_roles:edit') return;
    setLocalKeys((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  }

  function handleSave() {
    setSaveError(null);
    startTransition(async () => {
      try {
        await setRolePermissions(role.id, Array.from(localKeys));
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : 'Lỗi khi lưu');
      }
    });
  }

  function handleDelete() {
    setDeleteError(null);
    startTransition(async () => {
      try {
        await deleteRole(role.id);
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : 'Lỗi khi xoá');
      }
    });
  }

  return (
    <Card className="overflow-hidden">
      {/* Card header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2 min-w-0">
          {role.isSystem && (
            <Lock className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="font-semibold text-sm truncate">{role.name}</span>
          <span className="font-mono text-xs text-muted-foreground shrink-0">{role.key}</span>
          {role.isSystem && (
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wider h-4 px-1.5">
              hệ thống
            </Badge>
          )}
          {role.description && (
            <span className="text-xs text-muted-foreground truncate hidden md:block">— {role.description}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {canDelete && !role.isSystem && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-3 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={handleDelete}
              disabled={pending}
            >
              Xoá
            </Button>
          )}
        </div>
      </div>

      {deleteError && (
        <div className="px-5 py-2 text-xs text-destructive bg-destructive/5 border-b border-border">
          {deleteError}
        </div>
      )}

      {/* Permission matrix table */}
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left px-4 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider w-56">
                Module
              </th>
              {ACTION_ORDER.map((action) => (
                <th
                  key={action}
                  className="px-3 py-2.5 font-medium text-xs text-muted-foreground uppercase tracking-wider text-center min-w-[60px]"
                >
                  {ACTION_LABELS[action]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalog.map((scope, idx) => (
              <tr
                key={scope.key}
                className={`border-b border-border last:border-0 ${idx % 2 === 0 ? '' : 'bg-muted/20'}`}
              >
                <td className="px-4 py-2.5 text-xs font-medium text-foreground whitespace-nowrap">
                  {scope.label}
                </td>
                {ACTION_ORDER.map((action) => {
                  const hasAction = (scope.actions as string[]).includes(action);
                  if (!hasAction) {
                    return (
                      <td key={action} className="px-3 py-2.5 text-center">
                        <span className="text-muted-foreground/25 text-xs">—</span>
                      </td>
                    );
                  }
                  const permKey = `${scope.key}:${action}`;
                  const isAntiLockout = role.key === 'admin' && permKey === 'users_roles:edit';
                  const checked = localKeys.has(permKey);
                  return (
                    <td key={action} className="px-3 py-2.5 text-center">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(scope.key, action)}
                        disabled={!canEdit || isAntiLockout || pending}
                        className="size-4 accent-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                        title={isAntiLockout ? 'Không thể bỏ quyền này (anti-lockout)' : permKey}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>

      {/* Card footer */}
      {canEdit && (
        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border bg-muted/10">
          {saveError ? (
            <span className="text-xs text-destructive">{saveError}</span>
          ) : (
            <span className="text-xs text-muted-foreground">{localKeys.size} quyền đã chọn</span>
          )}
          <Button
            size="sm"
            onClick={handleSave}
            disabled={pending}
            className="h-7 px-4 text-xs"
          >
            {pending ? 'Đang lưu…' : 'Lưu'}
          </Button>
        </div>
      )}
    </Card>
  );
}

// ─── Create-role form ─────────────────────────────────────────────────────────

function CreateRoleForm() {
  const [key, setKey] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!key.trim()) { setError('Key không được để trống'); return; }
    if (!name.trim()) { setError('Tên không được để trống'); return; }
    setError(null);
    startTransition(async () => {
      try {
        await createRole({ key: key.trim(), name: name.trim(), description: description.trim() || undefined });
        setKey('');
        setName('');
        setDescription('');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Lỗi khi tạo role');
      }
    });
  }

  return (
    <Card>
      <div className="flex items-center gap-2 px-5 py-4 border-b border-border bg-muted/30">
        <Plus className="size-4 text-muted-foreground" />
        <span className="font-semibold text-sm">Tạo role mới</span>
      </div>
      <CardContent className="p-5">
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1.5 min-w-[140px]">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Key
            </label>
            <Input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="vd: brand_manager"
              className="h-8 text-sm font-mono"
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5 min-w-[180px]">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Tên
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="vd: Brand Manager"
              className="h-8 text-sm"
              disabled={pending}
            />
          </div>
          <div className="space-y-1.5 flex-1 min-w-[200px]">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Mô tả (tuỳ chọn)
            </label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả ngắn về role này"
              className="h-8 text-sm"
              disabled={pending}
            />
          </div>
          <Button type="submit" disabled={pending} className="h-8 px-4 text-sm shrink-0">
            {pending ? 'Đang tạo…' : 'Tạo role'}
          </Button>
        </form>
        {error && (
          <p className="mt-2 text-xs text-destructive">{error}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Root export ──────────────────────────────────────────────────────────────

export function RoleMatrix({ roles, catalog, canEdit, canCreate, canDelete }: Props) {
  return (
    <div className="space-y-6">
      {roles.map((role) => (
        <RoleCard
          key={role.id}
          role={role}
          catalog={catalog}
          canEdit={canEdit}
          canDelete={canDelete}
        />
      ))}

      {roles.length === 0 && (
        <div className="text-center py-12 text-sm text-muted-foreground border border-dashed border-border rounded-xl">
          Chưa có role nào.
        </div>
      )}

      {canCreate && <CreateRoleForm />}
    </div>
  );
}
