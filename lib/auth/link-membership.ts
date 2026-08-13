/**
 * INSERT/UPDATE de user_organizations — núcleo compartilhado por qualquer
 * caller que já resolveu autorização por uma fonte confiável (token de
 * convite verificado, ou um admin autenticado provisionando direto).
 *
 * Service role é intencional: RLS em user_organizations exige admin da org
 * para INSERT/UPDATE, e quem está entrando ainda não é membro.
 *
 * Callers: lib/auth/accept-invite.ts (wrapper do fluxo de convite) e
 * lib/auth/provision-member.ts (cadastro direto por admin).
 */
import { createAdminClient } from "@/lib/supabase/admin";

export interface LinkMembershipInput {
  organizationId: string;
  role: string;
  invitedBy?: string | null;
  /** ISO 8601. Default: agora. O fluxo de convite reconstrói a partir do exp do token. */
  invitedAt?: string;
  /** Função/Departamento (lib/schemas/team.ts DEPARTMENTS). Opcional — só o cadastro direto envia. */
  department?: string | null;
}

export interface LinkMembershipResult {
  membershipId: string;
  reactivated: boolean;
}

export async function linkUserToOrganization(
  userId: string,
  input: LinkMembershipInput,
): Promise<LinkMembershipResult> {
  const db = createAdminClient();
  const { data: existing, error: fetchErr } = await db
    .from("user_organizations")
    .select("id, revoked_at")
    .eq("user_id", userId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (fetchErr) {
    throw new Error(`link membership: fetch failed: ${fetchErr.message}`);
  }

  const nowIso = new Date().toISOString();

  if (existing?.id) {
    const { error: updErr } = await db
      .from("user_organizations")
      .update({
        role: input.role,
        revoked_at: null,
        accepted_at: nowIso,
        updated_at: nowIso,
        ...(input.department !== undefined ? { department: input.department } : {}),
      })
      .eq("id", existing.id);
    if (updErr) {
      throw new Error(`link membership: update failed: ${updErr.message}`);
    }
    return { membershipId: existing.id, reactivated: !!existing.revoked_at };
  }

  const { data: inserted, error: insErr } = await db
    .from("user_organizations")
    .insert({
      user_id: userId,
      organization_id: input.organizationId,
      role: input.role,
      invited_by: input.invitedBy ?? null,
      invited_at: input.invitedAt ?? nowIso,
      accepted_at: nowIso,
      department: input.department ?? null,
    })
    .select("id")
    .single();
  if (insErr) {
    throw new Error(`link membership: insert failed: ${insErr.message}`);
  }
  return { membershipId: inserted.id, reactivated: false };
}
