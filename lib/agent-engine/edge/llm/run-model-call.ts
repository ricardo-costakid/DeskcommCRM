/**
 * SEAM ÚNICO de chamada de modelo: TODA chamada de LLM do harness passa por
 * runModelCall — agente, classificadores auxiliares e compaction usam esta MESMA
 * função (nenhum call site instancia provider).
 *
 * Por chamada: resolve a config da org no DB (BYOK em ai_provider_credentials +
 * knobs em organizations.settings->'llm'; troca de modelo/provider = UPDATE na
 * config, vale no run seguinte, sem restart) → checa o budget mensal ANTES de
 * sair byte para o provider → generateText do AI SDK → grava usage/custo em
 * llm_calls. A chave da org nunca entra em prompt, tool result ou log — ela só
 * cruza a fronteira na instância do provider.
 *
 * Shape do usage: `LanguageModelUsage` (node_modules/ai/dist/index.d.ts):
 * inputTokens/outputTokens totais + inputTokenDetails.{cacheReadTokens,
 * cacheWriteTokens}. Validado no ai@7 via scripts/smoke-llm.sh (modelo real) —
 * upgrade de major re-valida esses paths pelo mesmo gate (regra dura 16).
 */
import { generateText, stepCountIs, type ModelMessage, type ToolSet } from 'ai';
import type pg from 'pg';
import { z } from 'zod';

import type { Logger } from '../../obs/logger';
import { resolveOrgLlmConfig, type LlmEdgeConfig } from './credentials';
import { costCents } from './pricing';
import { createDefaultRegistry, type ProviderRegistry } from './providers';
import { buildStablePrefix } from './stable-prefix';

// Call sites FORA da camada importam os tipos daqui — nunca de 'ai' direto
// (o seam é a única porta). `tool` idem: é como o agente define ToolSet sem
// tocar no SDK.
export { tool } from 'ai';
export type { ModelMessage, ToolSet } from 'ai';
export type { LlmEdgeConfig } from './credentials';
export { llmEdgeConfigFromEnv, LlmNotConfiguredError } from './credentials';

/** Teto mensal da org esgotado — runs recusados ANTES do provider (zero tokens). */
export class LlmBudgetExceededError extends Error {
  override readonly name = 'llm_budget_exceeded';
  constructor() {
    super('orçamento mensal de LLM da org esgotado — chamada recusada; ajuste o teto ou aguarde a virada do mês (agent_inbox_items kind=budget_exceeded)');
  }
}

/** Provider da config sem entrada no registry — erro de config, nunca fallback. */
export class LlmProviderUnknownError extends Error {
  override readonly name = 'llm_provider_unknown';
  constructor(provider: string) {
    super(`provider LLM desconhecido na config da org: ${provider}`);
  }
}

/** Modelo pedido fora de enabled_models da org. */
export class LlmModelNotEnabledError extends Error {
  override readonly name = 'llm_model_not_enabled';
  constructor(model: string) {
    super(`modelo não habilitado para a org (enabled_models): ${model}`);
  }
}

// Whitelist de params da org (jsonb livre no DB → só o que o seam entende passa).
const paramsSchema = z
  .object({
    temperature: z.number().optional(),
    topP: z.number().optional(),
    topK: z.number().int().optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .passthrough();

export interface RunModelCallInput {
  tenantId: string;
  leadId?: string | null;
  jobId?: string | null;
  variantId?: string | null;
  /** atribuição de custo: 'agent_turn' (default) | 'classifier' | 'compaction' | 'connection_test' */
  purpose?: string;
  system?: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  /**
   * Override do modelo default da org — é como classificador/compaction usam um
   * modelo pequeno pela MESMA camada. Sujeito a enabled_models quando a lista
   * não é vazia. NUNCA um id hardcoded: o valor vem de config de quem chama.
   */
  model?: string;
  /**
   * Teto do loop de tool-calls do generateText (vira stopWhen: stepCountIs). Sem
   * ele o SDK para no 1º step (default stepCountIs(1)) — tools executam mas o
   * modelo não vê o resultado. Quem chama passa o knob (ex.: AGENT_MAX_STEPS do
   * agente), nunca constante.
   */
  maxSteps?: number;
  /**
   * Override de provider/credencial vindo da versão PUBLICADA do agente (Fase
   * 2B) — resolvido no seam, nunca no call site. Sem ele, config da org.
   */
  llmOverride?: import('./credentials').LlmResolveOverride;
  /**
   * Nome da tool que o modelo é OBRIGADO a chamar no PRIMEIRO step (step 0).
   * Do step 1 em diante o toolChoice volta a 'auto' e o modelo responde livre,
   * já com o resultado da tool na fita.
   *
   * Por que existe: a instrução textual na description da tool ("use ANTES de
   * responder dúvida factual") é sugestão, não garantia — medido no acervo do
   * tenant, 3 de 4 perguntas factuais cuja resposta EXISTE na KB (similaridade
   * 0.75–0.81, muito acima do limiar) foram respondidas sem nenhuma chamada de
   * busca registrada. Forçar o primeiro step é o único ponto onde o runtime,
   * e não o modelo, decide que a consulta acontece.
   *
   * Aplicado via `prepareStep` de propósito: um `toolChoice` no topo do
   * generateText valeria para TODO step, e com stopWhen=stepCountIs(maxSteps)
   * o modelo repetiria a mesma tool até estourar o teto sem nunca responder.
   *
   * Só o call site do turno do agente usa. Os demais (classificadores,
   * compaction, fechamento de checkpoint) omitem e seguem inalterados.
   */
  forceFirstTool?: string;
}

export interface RunModelCallDeps {
  registry?: ProviderRegistry;
  log?: Logger;
}

/**
 * Budget é enforcement do harness: agregado mensal de llm_calls × teto da org
 * (organizations.settings.llm.monthly_budget_cents), checado antes de QUALQUER
 * byte ao provider. Estouro → agent_inbox_items (1 por episódio: enquanto houver
 * item 'budget_exceeded' aberto, recusas novas não duplicam o alerta) + erro
 * tipado. ponytail: o insert-if-not-exists é um único statement; duas recusas
 * exatamente simultâneas podem duplicar o alerta — inócuo.
 */
async function assertBudget(db: pg.Pool, organizationId: string, budgetCents: number | null): Promise<void> {
  if (budgetCents === null) {
    return;
  }
  const { rows } = await db.query<{ spent: number }>(
    `select coalesce(sum(cost_cents), 0)::float8 as spent
     from llm_calls
     where organization_id = $1 and created_at >= date_trunc('month', now())`,
    [organizationId],
  );
  const spent = rows[0]?.spent ?? 0;
  if (spent < budgetCents) {
    return;
  }
  await db.query(
    `insert into agent_inbox_items (organization_id, kind, severity, title, body)
     select $1, 'budget_exceeded', 'critical',
            'Orçamento mensal de LLM esgotado — agente pausado para esta org',
            'gasto do mês atingiu o teto configurado em organizations.settings.llm.monthly_budget_cents; aumente o teto ou aguarde a virada do mês'
     where not exists (
       select 1 from agent_inbox_items
       where organization_id = $1 and kind = 'budget_exceeded' and status = 'open'
     )`,
    [organizationId],
  );
  throw new LlmBudgetExceededError();
}

export async function runModelCall(db: pg.Pool, cfg: LlmEdgeConfig, input: RunModelCallInput, deps: RunModelCallDeps = {}) {
  const registry = deps.registry ?? createDefaultRegistry();
  const config = await resolveOrgLlmConfig(db, cfg, input.tenantId, input.llmOverride);

  await assertBudget(db, input.tenantId, config.monthlyBudgetCents);

  const model = input.model ?? config.defaultModel;
  if (model === null || model === undefined) {
    throw new Error(
      'modelo LLM não definido — configure organizations.settings.llm.default_model ou passe input.model',
    );
  }
  if (config.enabledModels.length > 0 && !config.enabledModels.includes(model)) {
    throw new LlmModelNotEnabledError(model);
  }
  const factory = registry[config.provider];
  if (factory === undefined) {
    throw new LlmProviderUnknownError(config.provider);
  }
  const parsedParams = paramsSchema.safeParse(config.params);
  if (!parsedParams.success) {
    throw new Error('params inválidos em organizations.settings.llm.params — corrija a config da org');
  }
  const { temperature, topP, topK, maxOutputTokens } = parsedParams.data;

  // Disciplina de cache: o prefixo estável org-wide (system do playbook + tools
  // em ordem determinística) ganha os breakpoints AQUI, no seam — call sites
  // passam system/tools crus. Tudo por-lead vive em input.messages, DEPOIS do
  // breakpoint. TTL: knob LLM_CACHE_TTL; '1h' é a doutrina.
  const prefix = buildStablePrefix({
    system: input.system,
    tools: input.tools,
    cacheTtl: cfg.cacheTtl ?? '1h',
  });

  // Guard obrigatório: a tool forçada pode legitimamente não estar montada
  // (ex.: agente sem KB ativa remove search_knowledge do ToolSet). Nomear no
  // toolChoice uma tool ausente derruba o turno inteiro no provider — e derrubar
  // o atendimento do cliente para exigir uma busca é troca ruim. Ausente ⇒ o
  // turno roda como antes, sem forçar.
  const forcedTool =
    input.forceFirstTool !== undefined &&
    prefix.tools !== undefined &&
    input.forceFirstTool in prefix.tools
      ? input.forceFirstTool
      : null;
  if (input.forceFirstTool !== undefined && forcedTool === null) {
    deps.log?.warn('tool de primeiro step ausente do ToolSet — turno segue sem forçar', {
      force_first_tool: input.forceFirstTool,
    });
  }

  const startedAt = Date.now();
  // `system` aceita SystemModelMessage (com providerOptions de cache) — igual
  // em v6 e v7 (smoke prova que o cacheControl continua virando cache_control).
  const result = await generateText({
    model: factory(config.apiKey, model),
    system: prefix.system,
    messages: input.messages,
    tools: prefix.tools,
    stopWhen: input.maxSteps === undefined ? undefined : stepCountIs(input.maxSteps),
    ...(forcedTool !== null
      ? {
          prepareStep: ({ stepNumber }: { stepNumber: number }) =>
            stepNumber === 0 ? { toolChoice: { type: 'tool' as const, toolName: forcedTool } } : {},
        }
      : {}),
    temperature,
    topP,
    topK,
    maxOutputTokens,
  });
  const latencyMs = Date.now() - startedAt;

  const usage = {
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
    cacheReadTokens: result.usage.inputTokenDetails.cacheReadTokens ?? 0,
    cacheWriteTokens: result.usage.inputTokenDetails.cacheWriteTokens ?? 0,
  };
  const cost = costCents(model, usage);

  const { rows } = await db.query<{ id: string }>(
    `insert into llm_calls
       (organization_id, contact_id, job_id, variant_id, purpose, provider, model,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_cents, latency_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     returning id`,
    [
      input.tenantId,
      input.leadId ?? null,
      input.jobId ?? null,
      input.variantId ?? null,
      input.purpose ?? 'agent_turn',
      config.provider,
      model,
      usage.inputTokens,
      usage.outputTokens,
      usage.cacheReadTokens,
      usage.cacheWriteTokens,
      cost,
      latencyMs,
    ],
  );

  // Só métricas — nunca conteúdo de mensagem (PII) nem chave.
  deps.log?.info('llm: chamada concluída', {
    organization_id: input.tenantId,
    provider: config.provider,
    model,
    purpose: input.purpose ?? 'agent_turn',
    ...usage,
    cost_cents: cost,
    latency_ms: latencyMs,
  });

  return {
    result,
    callId: rows[0]?.id ?? null,
    provider: config.provider,
    model,
    usage,
    costCents: cost,
    latencyMs,
  };
}
