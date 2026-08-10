"use client";
import { useState } from "react";
import { toast } from "sonner";

import { useProvisionMembers, type ProvisionMemberResultDto } from "@/hooks/team/useProvisionMembers";
import { copyToClipboard } from "@/lib/clipboard";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLES, type Role } from "@/lib/schemas/team";

export function RegisterMemberForm() {
  const [emailsRaw, setEmailsRaw] = useState("");
  const [role, setRole] = useState<Role>("agent");
  const [results, setResults] = useState<ProvisionMemberResultDto[] | null>(null);
  const provision = useProvisionMembers();

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const emails = emailsRaw
      .split(/[\n,;]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    const unique = Array.from(new Set(emails));
    if (unique.length === 0) {
      toast.error("Adicione ao menos um email.");
      return;
    }
    if (unique.length > 20) {
      toast.error("Máximo 20 emails por cadastro.");
      return;
    }
    try {
      const res = await provision.mutateAsync({ members: unique.map((email) => ({ email, role })) });
      setResults(res.data.results);
      const okCount = res.data.results.filter((r) => r.ok).length;
      const koCount = res.data.results.length - okCount;
      toast.success(`${okCount} membro(s) cadastrado(s)${koCount > 0 ? `, ${koCount} falha(s).` : "."}`);
      setEmailsRaw("");
    } catch {
      /* showApiError handled */
    }
  };

  const succeeded = results?.filter((r) => r.ok) ?? [];
  const failed = results?.filter((r) => !r.ok) ?? [];

  return (
    <div className="grid gap-6 md:grid-cols-[1fr,2fr]">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="emails">Emails</Label>
          <Textarea
            id="emails"
            value={emailsRaw}
            onChange={(e) => setEmailsRaw(e.target.value)}
            rows={8}
            placeholder={"alice@empresa.com\nbob@empresa.com"}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="role">Role</Label>
          <Select value={role} onValueChange={(v) => setRole(v as Role)}>
            <SelectTrigger id="role">
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
