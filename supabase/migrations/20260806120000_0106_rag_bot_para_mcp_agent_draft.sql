-- 0106_rag_bot_para_mcp_agent_draft
--
-- Reconciliação de drift documentada no commit f2c1e08 ("o runtime migrou
-- para agentes versionados e o onboarding ficou no formato do rag_bot
-- legado"): todo agente kind='rag_bot' é editado pela tela pré-EPIC-13
-- (app/app/ai/agents/[id]/page.tsx só monta esse editor quando kind !=
-- 'mcp_agent'), que grava direto em ai_agents.system_prompt/is_active — duas
-- colunas que o runtime real (agent-engine, lib/agent-engine/agent/agent-
-- config.ts) NUNCA lê. Ele só lê ai_agent_versions via
-- ai_agents.published_version_id. Resultado: toda edição feita nessa tela é
-- invisível para quem realmente responde no WhatsApp, e o toggle "Agent
-- ativo" não pausa nada.
--
-- Esta migration cria, para cada agente kind='rag_bot' não-arquivado, uma
-- ai_agent_versions nova em status='draft' com o system_prompt que está
-- REALMENTE salvo em ai_agents.system_prompt agora (não o texto congelado de
-- uma versão antiga) e vira o agente para kind='mcp_agent' — isso destrava o
-- editor novo (com draft/publish, tools, RAG por tool). NÃO publica: o
-- publish exige ai_agent_versions.credential_id apontando para uma
-- ai_provider_credentials ativa+validada (fn_publish_ai_agent_version,
-- migration 0024+), e decidir qual credencial usar é do admin, pela tela.
--
-- Idempotente: processa só kind='rag_bot'; ao rodar de novo (update.sh
-- seguinte), quem já foi migrado não bate mais no filtro.
-- Auto-curativa: ai_agent_versions.channel_session_id é NOT NULL — org sem
-- nenhum channel_session ainda não tem como criar a versão, então o agente
-- É PULADO (kind continua 'rag_bot') e é pego automaticamente assim que a
-- org conectar um número de WhatsApp e este update.sh rodar de novo.
-- Sem BEGIN/COMMIT (o runner já envolve em transação); só CTEs, psql puro.

with alvo as (
  select
    a.id as agent_id,
    a.organization_id,
    coalesce(
      nullif(trim(a.system_prompt), ''),
      'Você é um atendente. Responda de forma educada e clara, em pt-BR.'
    ) as system_prompt,
    coalesce(nullif(trim(a.model), ''), 'anthropic/claude-sonnet-4-6') as model,
    a.created_by,
    coalesce(
      (select max(v.version_number) from public.ai_agent_versions v where v.agent_id = a.id),
      0
    ) + 1 as next_version_number,
    (
      select cs.id from public.channel_sessions cs
      where cs.organization_id = a.organization_id
      order by cs.created_at asc
      limit 1
    ) as channel_session_id
  from public.ai_agents a
  where a.kind = 'rag_bot'
    and a.archived_at is null
),
elegivel as (
  select * from alvo where channel_session_id is not null
),
inserido as (
  insert into public.ai_agent_versions (
    organization_id, agent_id, version_number, system_prompt,
    provider, model, channel_session_id, status, created_by
  )
  select
    e.organization_id,
    e.agent_id,
    e.next_version_number,
    e.system_prompt,
    case
      when split_part(e.model, '/', 1) in ('anthropic', 'openai', 'google')
        then split_part(e.model, '/', 1)
      else 'anthropic'
    end as provider,
    case
      when position('/' in e.model) > 0 then split_part(e.model, '/', 2)
      else e.model
    end as model,
    e.channel_session_id,
    'draft',
    e.created_by
  from elegivel e
  returning agent_id
)
update public.ai_agents a
   set kind = 'mcp_agent'
  from inserido i
 where a.id = i.agent_id;
