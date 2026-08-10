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
      error:
        | "validation_error"
        | "session_expired"
        | "same_password"
        | "update_failed"
        | "metadata_clear_failed";
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

  // A senha já foi trocada com sucesso acima. `must_change_password` mora em
  // app_metadata (não user_metadata) de propósito: app_metadata só é
  // gravável pelo client admin (service role), então um membro provisionado
  // não consegue limpar a própria flag via updateUser({ data }) — que só
  // escreve user_metadata, por design do GoTrue. Isso significa que não dá
  // pra fazer as duas mudanças (senha + flag) numa chamada atômica só:
  // precisa ser essa segunda chamada, com o admin client.
  //
  // Por isso, ao contrário de um fire-and-forget comum, uma falha aqui NÃO
  // pode virar `ok: true` silencioso: se cair nisso, o layout server-side
  // relê app_metadata.must_change_password (ainda true) e o gate reaparece
  // — mas a senha já mudou, então uma nova tentativa com a "mesma" senha
  // agora esbarra em same_password e trava o usuário sem saída de
  // self-service. Por isso devolvemos um erro distinto (metadata_clear_failed)
  // e não emitimos o audit de conclusão — a ação não terminou de fato.
  const admin = createAdminClient();
  const { error: metaErr } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { ...user.app_metadata, must_change_password: false },
  });
  if (metaErr) {
    console.error("[auth] falha ao limpar must_change_password", metaErr.message);
    return { ok: false, error: "metadata_clear_failed" };
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
