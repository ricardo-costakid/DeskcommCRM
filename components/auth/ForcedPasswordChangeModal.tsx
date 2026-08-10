"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { completeForcedPasswordChange } from "@/app/actions/auth/completeForcedPasswordChange";

/**
 * Troca de senha obrigatória no primeiro login de membro cadastrado direto
 * por um admin (senha temporária). Ao concluir, recarrega a página — o
 * layout server-side relê user_metadata.must_change_password (agora false)
 * e o gate some. Mesmo mecanismo de MfaEnrollModal.
 */
export function ForcedPasswordChangeModal() {
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsPending(true);
    const res = await completeForcedPasswordChange({ password, password_confirm: passwordConfirm });
    setIsPending(false);
    if (!res.ok) {
      if (res.error === "validation_error") {
        const first = Object.values(res.details ?? {})[0] as string[] | undefined;
        setError(first?.[0] ?? "Dados inválidos.");
      } else if (res.error === "same_password") {
        setError("A nova senha precisa ser diferente da temporária.");
      } else if (res.error === "session_expired") {
        setError("Sessão expirada — recarregue a página e faça login novamente.");
      } else {
        setError("Não foi possível trocar a senha. Tente novamente.");
      }
      return;
    }
    window.location.reload();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="forced-password-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
    >
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl">
        <div className="space-y-4">
          <div>
            <h2 id="forced-password-title" className="text-xl font-semibold">
              Defina sua senha
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Você entrou com uma senha temporária. Defina uma nova senha para continuar.
            </p>
          </div>
          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">Nova senha</Label>
              <Input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={8}
                required
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password-confirm">Confirmar nova senha</Label>
              <Input
                id="new-password-confirm"
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                minLength={8}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={isPending}>
              {isPending ? "Salvando..." : "Definir nova senha"}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
