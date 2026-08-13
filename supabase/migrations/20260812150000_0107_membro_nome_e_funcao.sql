-- 0107_membro_nome_e_funcao
--
-- Adiciona `department` (Função/Departamento) a user_organizations — é dado
-- por-vínculo (varia por org à qual a pessoa pertence), então não cabe em
-- auth.users.user_metadata (global ao usuário). "Nome" não ganha coluna:
-- passa a reaproveitar user_metadata.full_name (GoTrue), já lido por
-- app/api/v1/team/route.ts e app/api/v1/team/assignable/route.ts.
--
-- Vocabulário fechado (lib/schemas/team.ts DEPARTMENTS) pela lista real da
-- equipe: psicólogo, assistente social, administrativo. Nullable — membros
-- cadastrados antes desta migration ficam com department=null até serem
-- editados; sem preenchimento retroativo automático.

alter table "public"."user_organizations"
  add column if not exists "department" text;

alter table "public"."user_organizations"
  drop constraint if exists "user_organizations_department_check";

alter table "public"."user_organizations"
  add constraint "user_organizations_department_check"
  check (
    "department" is null
    or "department" = any (array['psicologo', 'assistente_social', 'administrativo'])
  );

comment on column "public"."user_organizations"."department" is
  'Função/Departamento do membro dentro do tenant (psicologo | assistente_social | administrativo). Distinto de "role" (RBAC: viewer/agent/manager/admin). Nullable — preenchido no cadastro direto ou via edição posterior.';
