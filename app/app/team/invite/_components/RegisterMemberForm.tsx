"use client";
import { useId, useState } from "react";
import { toast } from "sonner";

import { useProvisionMembers, type ProvisionMemberResultDto } from "@/hooks/team/useProvisionMembers";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DEPARTMENT_LABEL, DEPARTMENTS, ROLES, type Department, type Role } from "@/lib/schemas/team";
import { Trash } from "@/lib/ui/icons";

const MAX_MEMBERS = 20;

interface MemberRow {
  key: string;
  email: string;
  fullName: string;
  department: Department | "";
}

function emptyRow(key: string): MemberRow {
  return { key, email: "", fullName: "", department: "" };
}

export function RegisterMemberForm() {
  const makeKey = useId();
  const [rowCount, setRowCount] = useState(1);
  const [rows, setRows] = useState<MemberRow[]>([emptyRow(`${makeKey}-0`)]);
  const [role, setRole] = useState<Role>("agent");
  const [results, setResults] = useState<ProvisionMemberResultDto[] | null>(null);
  const provision = useProvisionMembers();

  const updateRow = (key: string, patch: Partial<MemberRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    if (rows.length >= MAX_MEMBERS) return;
    const next = rowCount;
    setRowCount(next + 1);
    setRows((prev) => [...prev, emptyRow(`${makeKey}-${next}`)]);
  };

  const removeRow = (key: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const trimmed = rows.map((r) => ({
      ...r,
      email: r.email.trim().toLowerCase(),
      fullName: r.fullName.trim(),
    }));

    if (trimmed.some((r) => !r.email || !r.fullName || !r.department)) {
      toast.error("Preencha email, nome e função em todas as linhas.");
      return;
    }
    const emails = trimmed.map((r) => r.email);
    if (new Set(emails).size !== emails.length) {
      toast.error("Emails duplicados na lista.");
      return;
    }

    try {
      const res = await provision.mutateAsync({
        members: trimmed.map((r) => ({
          email: r.email,
          role,
          full_name: r.fullName,
          department: r.department as Department,
        })),
      });
      setResults(res.data.results);
      const okCount = res.data.results.filter((r) => r.ok).length;
      const koCount = res.data.results.length - okCount;
      toast.success(`${okCount} membro(s) cadastrado(s)${koCount > 0 ? `, ${koCount} falha(s).` : "."}`);
      setRows([emptyRow(`${makeKey}-${rowCount}`)]);
      setRowCount(rowCount + 1);
    } catch {
      /* showApiError handled */
    }
  };

  const succeeded = results?.filter((r) => r.ok) ?? [];
  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <div className="grid gap-6 md:grid-cols-[3fr,2fr]">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger id="role" className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">Compartilhada por todos os membros deste cadastro.</p>
        </div>

        <div className="space-y-3">
          {rows.map((row, idx) => (
            <div
              key={row.key}
              data-testid={`member-row-${idx}`}
              className="grid grid-cols-[2fr,2fr,1.4fr,auto] items-end gap-2 rounded-md border p-3"
            >
              <div className="space-y-1">
                <Label htmlFor={`email-${row.key}`}>Email</Label>
                <Input
                  id={`email-${row.key}`}
                  type="email"
                  value={row.email}
                  onChange={(e) => updateRow(row.key, { email: e.target.value })}
                  placeholder="pessoa@empresa.com"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`name-${row.key}`}>Nome</Label>
                <Input
                  id={`name-${row.key}`}
                  value={row.fullName}
                  onChange={(e) => updateRow(row.key, { fullName: e.target.value })}
                  maxLength={120}
                  placeholder="Nome completo"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor={`department-${row.key}`}>Função</Label>
                <Select
                  value={row.department}
                  onValueChange={(v) => updateRow(row.key, { department: v as Department })}
                >
                  <SelectTrigger id={`department-${row.key}`}>
                    <SelectValue placeholder="Selecione" />
                  </SelectTrigger>
                  <SelectContent>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {DEPARTMENT_LABEL[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remover linha ${idx + 1}`}
                disabled={rows.length <= 1}
                onClick={() => removeRow(row.key)}
              >
                <Trash size={18} />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <Button type="button" variant="outline" onClick={addRow} disabled={rows.length >= MAX_MEMBERS}>
            + Adicionar linha
          </Button>
          <span className="text-xs text-muted-foreground">
            {rows.length}/{MAX_MEMBERS}
          </span>
        </div>

        <Button type="submit" disabled={provision.isPending}>
          {provision.isPending ? "Cadastrando…" : "Cadastrar membros"}
        </Button>
      </form>

      <div className="space-y-4">
        {results ? (
          <>
            {succeeded.length > 0 ? (
              <section>
                <h2 className="text-sm font-semibold">Cadastrados ({succeeded.length})</h2>
                <p className="text-xs text-muted-foreground">
                  Copie as senhas agora — não serão exibidas novamente.
                </p>
                <ul className="mt-2 space-y-2 text-sm">
                  {succeeded.map((r) => (
                    <li key={r.email} className="rounded-md border p-2">
                      <div className="font-medium">{r.email}</div>
                      <div className="mt-1 flex items-center gap-2">
                        <code className="break-all rounded bg-muted px-2 py-1 text-xs">{r.password}</code>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            void copyToClipboard(r.password ?? "").then((copied) => {
                              if (copied) toast.success("Senha copiada.");
                              else toast.error("Não foi possível copiar — selecione o texto acima.");
                            });
                          }}
                        >
                          Copiar
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {failed.length > 0 ? (
              <section>
                <h2 className="text-sm font-semibold text-destructive">Falhas ({failed.length})</h2>
                <ul className="mt-2 space-y-1 text-sm">
                  {failed.map((r) => (
                    <li key={r.email}>
                      <span className="font-medium">{r.email}</span>{" "}
                      <span className="text-muted-foreground">— {r.message}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Resultados aparecerão aqui após o cadastro.</p>
        )}
      </div>
    </div>
  );
}
