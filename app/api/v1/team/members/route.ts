/**
 * POST /api/v1/team/members — cadastra membro direto: já ativo, com senha
 * temporária gerada pelo servidor, sem e-mail de confirmação.
 *
 * Ao lado de /api/v1/team/invite (que continua existindo — o onboarding
 * ainda depende dele). Esta rota é só para a tela Equipe.
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { ApiError } from "@/lib/api/types";
import { requireRole } from "@/lib/auth/require-role";
import { createAdminClient } from "@/lib/supabase/admin";
import { isServiceRoleConfigured } from "@/lib/audit";
import { provisionMembersSchema, validateRequest } from "@/lib/schemas";
import { provisionMemberDirect, type ProvisionMemberResult } from "@/lib/auth/provision-member";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("admin", { requestId, resource: "team" });
  if (!authz.ok) return authz.response;
  const { user: authUser, org: activeOrg } = authz;

  let input;
  try {
    input = await validateRequest(provisionMembersSchema, req);
  } catch (err) {
    if (err instanceof ApiError) {
      return fail(err.code, err.message, err.status, {
        details: err.details as Record<string, unknown> | undefined,
        requestId,
      });
    }
    throw err;
  }

  if (!isServiceRoleConfigured()) {
    return fail("unavailable", "Cadastro direto de membro exige service role configurada.", 503, {
      requestId,
    });
  }

  const admin = createAdminClient();

  // E-mails já vinculados a ESTA org (ativos OU revogados) — resolvido via
  // GoTrue admin API (schema `auth` não é exposto via PostgREST), mesmo
  // padrão de app/api/v1/team/invite/route.ts:68-84, mas SEM o filtro
  // revoked_at IS NULL: aqui precisamos diferenciar revogado de "nunca foi
  // membro" pra dar a mensagem de erro certa (ver provisionMemberDirect).
  const orgMembersByEmail = new Map<string, { revokedAt: string | null }>();
  const { data: existingRows } = await admin
    .from("user_organizations")
    .select("user_id, revoked_at")
    .eq("organization_id", activeOrg.orgId);
  for (const row of existingRows ?? []) {
    const { data: u } = await admin.auth.admin.getUserById(row.user_id as string);
    const email = u?.user?.email?.trim().toLowerCase();
    if (email) orgMembersByEmail.set(email, { revokedAt: (row.revoked_at as string | null) ?? null });
  }

  const results: ProvisionMemberResult[] = [];
  for (const m of input.members) {
    const result = await provisionMemberDirect(
      authUser.id,
      { email: m.email, role: m.role, organizationId: activeOrg.orgId },
      orgMembersByEmail,
    );
    results.push(result);
  }

  return ok({ results }, { status: 201, requestId });
}
