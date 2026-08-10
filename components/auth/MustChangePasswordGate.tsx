"use client";

import { useState } from "react";

import { ForcedPasswordChangeModal } from "@/components/auth/ForcedPasswordChangeModal";

/**
 * Bloqueia o shell inteiro pra quem foi cadastrado direto por um admin
 * (senha temporária) até trocar a senha. Mesmo padrão de latch de
 * MfaEnrollGate: a decisão de bloquear trava no primeiro mount, mesmo que o
 * layout server-side revalide a rota no meio da troca.
 */
export function MustChangePasswordGate({
  mustChangePassword,
  children,
}: {
  mustChangePassword: boolean;
  children: React.ReactNode;
}) {
  const [blocking] = useState(mustChangePassword);

  if (!blocking) return <>{children}</>;

  return (
    <div className="fixed inset-0 z-50 bg-background">
      <div className="absolute inset-0 flex items-center justify-center p-4">
        <p className="text-sm text-muted-foreground">Aguardando troca de senha...</p>
      </div>
      <ForcedPasswordChangeModal />
    </div>
  );
}
