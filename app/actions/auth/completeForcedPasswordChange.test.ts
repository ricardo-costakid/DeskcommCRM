import { beforeEach, describe, expect, it, vi } from "vitest";

import { completeForcedPasswordChange } from "@/app/actions/auth/completeForcedPasswordChange";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { audit } from "@/lib/audit";

vi.mock("next/headers", () => ({
  headers: async () => new Map([["x-request-id", "req-1"]]),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

const USER_ID = "11111111-1111-4111-8111-111111111111";

function stubSupabase(opts: { updateUserError?: { message: string } | null }) {
  return {
    auth: {
      getUser: async () => ({
        data: { user: { id: USER_ID, app_metadata: { must_change_password: true } } },
      }),
      updateUser: vi.fn(async () => ({ error: opts.updateUserError ?? null })),
    },
  };
}

function stubAdmin(opts: { updateUserByIdError?: { message: string } | null } = {}) {
  return {
    auth: { admin: { updateUserById: vi.fn(async () => ({ error: opts.updateUserByIdError ?? null })) } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("completeForcedPasswordChange", () => {
  it("senhas não coincidem → validation_error, sem chamar updateUser", async () => {
    const supabase = stubSupabase({});
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const res = await completeForcedPasswordChange({ password: "abcdefgh", password_confirm: "different" });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("unreachable");
    expect(res.error).toBe("validation_error");
    expect(supabase.auth.updateUser).not.toHaveBeenCalled();
  });

  it("sucesso: troca a senha, limpa must_change_password preservando outras chaves do metadata, audita sem senha", async () => {
    const supabase = stubSupabase({});
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const admin = stubAdmin();
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await completeForcedPasswordChange({
      password: "novaSenhaForte1",
      password_confirm: "novaSenhaForte1",
    });

    expect(res).toEqual({ ok: true });
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: "novaSenhaForte1" });
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith(USER_ID, {
      app_metadata: { must_change_password: false },
    });
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "auth.forced_password_change_completed", actorUserId: USER_ID }),
    );
    expect(JSON.stringify(vi.mocked(audit).mock.calls[0]![0])).not.toContain("novaSenhaForte1");
  });

  it("senha trocada mas limpeza de app_metadata falha → metadata_clear_failed, sem audit (ação não completou)", async () => {
    const supabase = stubSupabase({});
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    const admin = stubAdmin({ updateUserByIdError: { message: "admin update failed" } });
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    const res = await completeForcedPasswordChange({
      password: "novaSenhaForte1",
      password_confirm: "novaSenhaForte1",
    });

    expect(res).toEqual({ ok: false, error: "metadata_clear_failed" });
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: "novaSenhaForte1" });
    expect(admin.auth.admin.updateUserById).toHaveBeenCalledWith(USER_ID, {
      app_metadata: { must_change_password: false },
    });
    expect(audit).not.toHaveBeenCalled();
  });

  it("mesma senha da temporária (GoTrue recusa) → same_password", async () => {
    const supabase = stubSupabase({
      updateUserError: { message: "New password should be different from the old password." },
    });
    vi.mocked(createClient).mockResolvedValue(supabase as never);

    const res = await completeForcedPasswordChange({ password: "mesmaSenha1", password_confirm: "mesmaSenha1" });

    expect(res).toEqual({ ok: false, error: "same_password" });
  });

  it("sem sessão → session_expired", async () => {
    vi.mocked(createClient).mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null } }), updateUser: vi.fn() },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const res = await completeForcedPasswordChange({ password: "abcdefgh", password_confirm: "abcdefgh" });

    expect(res).toEqual({ ok: false, error: "session_expired" });
  });
});
