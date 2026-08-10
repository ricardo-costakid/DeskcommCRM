/**
 * Cadastro direto de membro por um admin — cria a conta no GoTrue (ativa,
 * senha temporária, sem e-mail de confirmação) e vincula à org via o mesmo
 * núcleo usado pelo fluxo de convite (linkUserToOrganization).
 *
 * A checagem de e-mail já vinculado a ESTA org (ativo ou revogado) é feita
 * pelo caller (route handler) — um único fetch por request, compartilhado
 * entre todos os itens do lote — e passada aqui via `orgMembersByEmail`.
 * Sem essa pré-checagem, um membro revogado desta org cairia no mesmo erro
 * genérico "e-mail já cadastrado em outro lugar" — mensagem enganosa, já
 * que a conta existente É a conta que precisaria ser reativada.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";
import { linkUserToOrganization } from "@/lib/auth/link-membership";
import { generateTempPassword } from "@/lib/auth/temp-password";

export interface ProvisionMemberInput {
  email: string;
  role: string;
  organizationId: string;
}

export type OrgMemberStatus = { revokedAt: string | null };

export type ProvisionMemberResult =
  | { email: string; ok: true; password: string }
  | {
      email: string;
      ok: false;
      error: "already_member" | "revoked_member" | "email_already_registered" | "provision_failed";
      message: string;
    };

export async function provisionMemberDirect(
  actorUserId: string,
  input: ProvisionMemberInput,
  orgMembersByEmail: Map<string, OrgMemberStatus>,
): Promise<ProvisionMemberResult> {
  const email = input.email.trim().toLowerCase();
  const existing = orgMembersByEmail.get(email);

  if (existing && existing.revokedAt === null) {
    return {
      email,
      ok: false,
      error: "already_member",
      message: "Este e-mail já é membro ativo desta organização.",
    };
  }

  if (existing && existing.revokedAt !== null) {
    return {
      email,
      ok: false,
      error: "revoked_member",
      message:
        "Este e-mail pertence a um membro cujo acesso foi revogado nesta organização. " +
        "Não existe hoje uma ação de reativação na tela Equipe — cadastrar de novo não " +
        "resolve, porque o e-mail já tem conta.",
    };
  }

  const admin = createAdminClient();
  const password = generateTempPassword();
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { must_change_password: true },
  });

  if (createErr || !created?.user) {
    const isDuplicate = /already.*regist/i.test(createErr?.message ?? "");
    if (isDuplicate) {
      return {
        email,
        ok: false,
        error: "email_already_registered",
        message: "Este e-mail já tem uma conta — peça para essa pessoa entrar com a conta existente.",
      };
    }
    return {
      email,
      ok: false,
      error: "provision_failed",
      message: createErr?.message ?? "Falha ao criar usuário.",
    };
  }

  const link = await linkUserToOrganization(created.user.id, {
    organizationId: input.organizationId,
    role: input.role,
    invitedBy: actorUserId,
  });

  await audit({
    action: "member.provisioned",
    actorUserId,
    organizationId: input.organizationId,
    resourceType: "membership",
    resourceId: link.membershipId,
    metadata: { role: input.role },
  });

  return { email, ok: true, password };
}
