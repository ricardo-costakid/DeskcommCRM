import Link from "next/link";

import { SignupForm } from "@/components/auth/SignupForm";
import { branding } from "@/lib/branding";
import { verifyInviteToken } from "@/lib/auth/invite-token";

export const metadata = { title: "Criar conta" };

// /login "Criar conta" propaga o `next` de um /team/accept-invite/<token> que
// caiu aqui por falta de conta — extrai o token pra não perder o vínculo com
// a org/role do convite.
const ACCEPT_INVITE_PATH = /^\/team\/accept-invite\/([^/?]+)\/?$/;

interface PageProps {
  searchParams: Promise<{ next?: string }>;
}

export default async function SignupPage({ searchParams }: PageProps) {
  const { next } = await searchParams;
  const token = next ? ACCEPT_INVITE_PATH.exec(next)?.[1] : undefined;
  const invitePayload = token ? verifyInviteToken(token) : null;
  const inviteInvalid = !!token && !invitePayload;

  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">Criar conta</h1>
        <p className="text-sm text-muted-foreground">
          {invitePayload
            ? `Você foi convidado como ${invitePayload.role}. Crie sua senha para entrar.`
            : `Comece a usar o ${branding().name} em minutos`}
        </p>
      </div>
      {inviteInvalid && (
        <div
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          Este link de convite é inválido ou expirado. Peça um novo ao admin, ou crie uma
          conta própria abaixo.
        </div>
      )}
      <SignupForm
        inviteToken={invitePayload ? token : undefined}
        inviteEmail={invitePayload?.email}
      />
      <p className="text-center text-sm text-muted-foreground">
        Já tem conta?{" "}
        <Link href={loginHref} className="font-medium text-foreground underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </div>
  );
}
