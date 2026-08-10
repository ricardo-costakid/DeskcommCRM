// tests/e2e/direct-member-provisioning.spec.ts
/**
 * E2E do cadastro direto de membro (substitui convite por e-mail na tela
 * Equipe) — Playwright.
 *
 * Cobre:
 *   1. Ciclo feliz: admin cadastra → membro nasce ativo com senha temporária
 *      → novo usuário loga com ela → MustChangePasswordGate bloqueia → troca
 *      a senha → acessa o app normalmente.
 *   2. already_member: cadastrar quem já é membro ativo desta org.
 *   3. revoked_member: cadastrar quem é membro revogado desta org — mensagem
 *      distinta, sem reativação automática.
 *
 * Pré-req: .e2e-creds.json (scripts/seed-e2e-credentials.ts, roda sozinho se
 * faltar via helpers/login-admin.ts).
 */
import { createClient } from "@supabase/supabase-js";
import { test, expect } from "@playwright/test";

import { lerCreds, loginComoAdmin } from "./helpers/login-admin";
import { uniqueEmail } from "./helpers/auth";

const svc = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

async function membershipRow(userId: string, orgId: string) {
  const { data } = await svc
    .from("user_organizations")
    .select("id, role, accepted_at, revoked_at")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return data as { id: string; role: string; accepted_at: string | null; revoked_at: string | null } | null;
}

async function findAuthUserByEmail(email: string) {
  const { data } = await svc.auth.admin.listUsers({ perPage: 200 });
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function deleteAuthUserByEmail(email: string): Promise<void> {
  // GoTrue admin não filtra por email (sem getUserByEmail no supabase-js) —
  // busca linear numa base de teste pequena é aceitável aqui.
  const found = await findAuthUserByEmail(email);
  if (found) await svc.auth.admin.deleteUser(found.id);
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("cadastro direto de membro (tela Equipe)", () => {
  const creds = lerCreds();
  let orgId: string;

  test.beforeAll(async () => {
    const adminUser = await findAuthUserByEmail(creds.users.admin!.email);
    const { data: membership } = await svc
      .from("user_organizations")
      .select("organization_id")
      .eq("user_id", adminUser!.id)
      .eq("role", "admin")
      .is("revoked_at", null)
      .limit(1)
      .maybeSingle();
    orgId = (membership as { organization_id: string }).organization_id;
  });

  test("1. ciclo feliz: cadastra → senha temporária funciona → gate força troca → acesso normal", async ({
    page,
    browser,
  }) => {
    const email = uniqueEmail("provision");
    await deleteAuthUserByEmail(email);

    await loginComoAdmin(page, creds);
    const res = await page.request.post("/api/v1/team/members", {
      data: { members: [{ email, role: "agent" }] },
    });
    expect(res.status(), await res.text()).toBe(201);
    const json = (await res.json()) as {
      data: { results: Array<{ email: string; ok: boolean; password?: string }> };
    };
    const item = json.data.results[0];
    expect(item?.ok).toBe(true);
    const tempPassword = item!.password!;
    expect(tempPassword.length).toBeGreaterThanOrEqual(8);

    const created = await findAuthUserByEmail(email);
    expect(created).toBeTruthy();
    const membership = await membershipRow(created!.id, orgId);
    expect(membership?.role).toBe("agent");
    expect(membership?.accepted_at).toBeTruthy();
    expect(membership?.revoked_at).toBeNull();

    const memberCtx = await browser.newContext();
    const memberPage = await memberCtx.newPage();
    await memberPage.goto("/login");
    await memberPage.locator("#email").fill(email);
    await memberPage.locator("#password").fill(tempPassword);
    await memberPage.getByRole("button", { name: /entrar/i }).click();

    await expect(memberPage.getByRole("heading", { name: /Defina sua senha/i })).toBeVisible({
      timeout: 30_000,
    });

    await memberPage.locator("#new-password").fill("novaSenhaForte123");
    await memberPage.locator("#new-password-confirm").fill("novaSenhaForte123");
    await memberPage.getByRole("button", { name: /Definir nova senha/i }).click();

    await memberPage.waitForURL(/\/app\//, { timeout: 30_000 });
    await expect(memberPage.getByRole("heading", { name: /Defina sua senha/i })).not.toBeVisible();

    await memberCtx.close();
    await deleteAuthUserByEmail(email);
  });

  test("2. already_member: cadastrar quem já é membro ativo desta org", async ({ page }) => {
    await loginComoAdmin(page, creds);
    const existingEmail = creds.users.agent?.email ?? creds.users.admin!.email;
    const res = await page.request.post("/api/v1/team/members", {
      data: { members: [{ email: existingEmail, role: "agent" }] },
    });
    expect(res.status()).toBe(201);
    const json = (await res.json()) as {
      data: { results: Array<{ email: string; ok: boolean; error?: string }> };
    };
    const item = json.data.results[0];
    expect(item?.ok).toBe(false);
    expect(item?.error).toBe("already_member");
  });

  test("3. revoked_member: cadastrar quem é membro revogado desta org", async ({ page }) => {
    const email = uniqueEmail("revoked");
    await deleteAuthUserByEmail(email);

    const { data: created } = await svc.auth.admin.createUser({
      email,
      password: "senhaQualquer123",
      email_confirm: true,
    });
    await svc.from("user_organizations").insert({
      user_id: created!.user!.id,
      organization_id: orgId,
      role: "agent",
      accepted_at: new Date().toISOString(),
      revoked_at: new Date().toISOString(),
    });

    await loginComoAdmin(page, creds);
    const res = await page.request.post("/api/v1/team/members", {
      data: { members: [{ email, role: "agent" }] },
    });
    expect(res.status()).toBe(201);
    const json = (await res.json()) as {
      data: { results: Array<{ email: string; ok: boolean; error?: string; message?: string }> };
    };
    const item = json.data.results[0];
    expect(item?.ok).toBe(false);
    expect(item?.error).toBe("revoked_member");
    expect(item?.message).toContain("revogado");

    await deleteAuthUserByEmail(email);
  });
});
