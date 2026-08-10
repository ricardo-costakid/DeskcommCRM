"use server";
/**
 * Server Action: conclui a troca de senha obrigatória de um membro
 * cadastrado direto por um admin (senha temporária). Diferente de
 * updatePassword.ts (fluxo de recovery por link de e-mail): aqui o usuário
 * já está numa sessão normal de app, então NÃO desloga ao terminar — só
 * limpa a flag e deixa o MustChangePasswordGate recarregar a página.
 */
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resetPasswordSchema, type ResetPasswordInput } from "@/lib/auth/schemas";
import { audit } from "@/lib/audit";

export type CompleteForcedPasswordChangeResult =
  | { ok: true }
  | {
      ok: false;
      error: "validation_error" | "session_expired" | "same_password" | "update_failed";
      details?: Record<string, unknown>;
    };

export async function completeForcedPasswordChange(
  input: Pick<ResetPasswordInput, "password" | "password_confirm">,
): Promise<CompleteForcedPasswordChangeResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "validation_error", details: parsed.error.flatten().fieldErrors };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "session_expired" };

  const hdrs = await headers();
  const requestId = hdrs.get("x-request-id");
  const ip = hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = hdrs.get("user-agent") ?? null;

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) {
    if (/different from the old password/i.test(error.message)) {
      return { ok: false, error: "same_password" };
    }
    return { ok: false, error: "update_failed" };
  }

  // A senha já foi trocada com sucesso acima — se só a limpeza da flag
  // falhar, não travamos o usuário atrás do gate por causa disso (mesmo
  // espírito de audit(): fire-and-forget não bloqueia a mutação principal).
  const admin = createAdminClient();
  const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, must_change_password: false },
  });
  if (metaErr) {
    console.error("[auth] falha ao limpar must_change_password", metaErr.message);
  }

  await audit({
    action: "auth.forced_password_change_completed",
    actorUserId: user.id,
    requestId,
    ip,
    userAgent,
    metadata: {},
  });

  return { ok: true };
}
