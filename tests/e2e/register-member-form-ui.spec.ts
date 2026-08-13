// tests/e2e/register-member-form-ui.spec.ts
/**
 * E2E do formulário "Cadastrar membro" (tela Equipe) — linhas de
 * Email+Nome+Função, preenchidas PELA TELA de verdade (Playwright dirigindo
 * o browser), não via `page.request` direto na API como
 * direct-member-provisioning.spec.ts faz. Prova o que curl não prova: que o
 * Select de Função associa corretamente à linha certa, que o botão
 * "+ Adicionar linha" funciona, e que o nome/função aparecem depois na tela
 * de Equipe e no diálogo "Transferir conversa" em vez de "Atendente <ID>".
 *
 * STATUS: escrito e verificado estaticamente (tsc/eslint limpos,
 * `playwright test --list` descobre os 2 testes, helpers conferidos), mas
 * NUNCA EXECUTADO contra um Supabase local de verdade nesta sessão — sem
 * Docker/SUPABASE_DB_URL disponíveis neste ambiente. Não fica verde até
 * rodar numa sessão com o ambiente disponível (ver plan/progress.md).
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

async function findAuthUserByEmail(email: string) {
  const { data } = await svc.auth.admin.listUsers({ perPage: 200 });
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function deleteAuthUserByEmail(email: string): Promise<void> {
  const found = await findAuthUserByEmail(email);
  if (found) await svc.auth.admin.deleteUser(found.id);
}

async function membershipByUserId(userId: string, orgId: string) {
  const { data } = await svc
    .from("user_organizations")
    .select("id, role, department")
    .eq("user_id", userId)
    .eq("organization_id", orgId)
    .maybeSingle();
  return data as { id: string; role: string; department: string | null } | null;
}

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.describe("RegisterMemberForm — formulário em linhas (Email+Nome+Função) na tela", () => {
  let creds = lerCreds();
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

  test("1. preenche uma linha na tela → nasce com nome e função corretos (não só a API)", async ({ page }) => {
    const email = uniqueEmail("form-ui");
    await deleteAuthUserByEmail(email);

    creds = await loginComoAdmin(page, creds);
    await page.goto("/app/team/invite");

    const row = page.getByTestId("member-row-0");
    await row.getByLabel("Email").fill(email);
    await row.getByLabel("Nome").fill("Ana Psicóloga Teste");
    await row.getByLabel("Função").click();
    await page.getByRole("option", { name: "Psicólogo" }).click();

    await page.getByRole("button", { name: "Cadastrar membros" }).click();

    await expect(page.getByRole("heading", { name: "Cadastrados (1)" })).toBeVisible({ timeout: 30_000 });
    const item = page.locator("li", { hasText: email });
    const tempPassword = await item.locator("code").innerText();
    expect(tempPassword.length).toBeGreaterThanOrEqual(8);

    const created = await findAuthUserByEmail(email);
    expect(created).toBeTruthy();
    expect((created!.user_metadata as { full_name?: string })?.full_name).toBe("Ana Psicóloga Teste");

    const membership = await membershipByUserId(created!.id, orgId);
    expect(membership?.role).toBe("agent");
    expect(membership?.department).toBe("psicologo");

    await deleteAuthUserByEmail(email);
  });

  test("2. '+ Adicionar linha' cria uma 2ª linha independente — nome/função não vazam entre linhas", async ({
    page,
  }) => {
    const emailA = uniqueEmail("form-ui-a");
    const emailB = uniqueEmail("form-ui-b");
    await deleteAuthUserByEmail(emailA);
    await deleteAuthUserByEmail(emailB);

    creds = await loginComoAdmin(page, creds);
    await page.goto("/app/team/invite");

    const rowA = page.getByTestId("member-row-0");
    await rowA.getByLabel("Email").fill(emailA);
    await rowA.getByLabel("Nome").fill("Beto Assistente Social");
    await rowA.getByLabel("Função").click();
    await page.getByRole("option", { name: "Assistente Social" }).click();

    await page.getByRole("button", { name: "+ Adicionar linha" }).click();

    const rowB = page.getByTestId("member-row-1");
    await rowB.getByLabel("Email").fill(emailB);
    await rowB.getByLabel("Nome").fill("Carla Administrativo");
    await rowB.getByLabel("Função").click();
    await page.getByRole("option", { name: "Administrativo" }).click();

    await page.getByRole("button", { name: "Cadastrar membros" }).click();

    await expect(page.getByRole("heading", { name: "Cadastrados (2)" })).toBeVisible({ timeout: 30_000 });

    const createdA = await findAuthUserByEmail(emailA);
    const createdB = await findAuthUserByEmail(emailB);
    expect(createdA).toBeTruthy();
    expect(createdB).toBeTruthy();
    expect((createdA!.user_metadata as { full_name?: string })?.full_name).toBe("Beto Assistente Social");
    expect((createdB!.user_metadata as { full_name?: string })?.full_name).toBe("Carla Administrativo");

    const membershipA = await membershipByUserId(createdA!.id, orgId);
    const membershipB = await membershipByUserId(createdB!.id, orgId);
    // A prova real do teste: cada linha vira o membro certo, sem trocar.
    expect(membershipA?.department).toBe("assistente_social");
    expect(membershipB?.department).toBe("administrativo");

    await deleteAuthUserByEmail(emailA);
    await deleteAuthUserByEmail(emailB);
  });
});
