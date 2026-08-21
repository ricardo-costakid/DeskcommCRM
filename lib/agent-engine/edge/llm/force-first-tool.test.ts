/**
 * Vigia o `forceFirstTool` do seam (run-model-call): a consulta ao acervo no
 * primeiro step é imposta pelo RUNTIME, não pedida ao modelo.
 *
 * O que estes testes guardam, e por que cada um existe:
 *  1. o prepareStep chega de fato ao generateText (fiação, não só cálculo);
 *  2. ele força SOMENTE o step 0 — um toolChoice válido para todo step faria o
 *     modelo repetir a mesma tool até estourar maxSteps e nunca responder;
 *  3. tool ausente do ToolSet NÃO é forçada (agente sem KB ativa) — nomear tool
 *     inexistente no toolChoice derrubaria o turno inteiro no provider;
 *  4. sem forceFirstTool, nenhum prepareStep é passado — os outros 12 call sites
 *     (classificadores, compaction, fechamento) seguem intocados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { generateText } from 'ai';
import type * as AiModule from 'ai';

import { runModelCall } from './run-model-call';
import { resolveOrgLlmConfig } from './credentials';

vi.mock('ai', async (importOriginal) => {
  const real = await importOriginal<typeof AiModule>();
  return { ...real, generateText: vi.fn() };
});
// Sem importOriginal: `./credentials` importa lib/crypto/aes_gcm → lib/env, que
// valida o ambiente do processo e derruba a suíte. Só os símbolos que
// run-model-call importa/reexporta precisam existir aqui.
vi.mock('./credentials', () => ({
  resolveOrgLlmConfig: vi.fn(),
  llmEdgeConfigFromEnv: vi.fn(),
  LlmNotConfiguredError: class LlmNotConfiguredError extends Error {},
}));

const mockGenerateText = vi.mocked(generateText);
const mockResolveConfig = vi.mocked(resolveOrgLlmConfig);

/** db.query: assertBudget não roda (budget null) e o insert de llm_calls devolve id. */
const db = { query: vi.fn().mockResolvedValue({ rows: [{ id: 'llm-call-1' }] }) } as never;
const llmCfg = {} as never;

const registry = { anthropic: () => (() => ({})) as never };

const TOOLS = {
  search_knowledge: { description: 'busca', inputSchema: {}, execute: async () => ({}) },
  send_message: { description: 'envia', inputSchema: {}, execute: async () => ({}) },
} as never;

function generateTextResult() {
  return {
    text: 'ok',
    steps: [],
    usage: { inputTokens: 10, outputTokens: 5, inputTokenDetails: {} },
    response: { messages: [] },
  };
}

/** O prepareStep efetivamente entregue ao generateText nesta chamada. */
function capturedPrepareStep(): ((o: { stepNumber: number }) => unknown) | undefined {
  const args = mockGenerateText.mock.calls[0]?.[0] as
    | { prepareStep?: (o: { stepNumber: number }) => unknown }
    | undefined;
  return args?.prepareStep;
}

async function callWith(extra: Record<string, unknown>) {
  await runModelCall(
    db,
    llmCfg,
    {
      tenantId: 'org-1',
      purpose: 'agent_turn',
      system: 'sys',
      messages: [{ role: 'user', content: 'quem é a assistente social?' }],
      tools: TOOLS,
      maxSteps: 8,
      ...extra,
    } as never,
    { registry: registry as never },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveConfig.mockResolvedValue({
    provider: 'anthropic',
    apiKey: 'k',
    defaultModel: 'claude-sonnet-4-5',
    enabledModels: [],
    monthlyBudgetCents: null,
    params: {},
  } as never);
  mockGenerateText.mockResolvedValue(generateTextResult() as never);
});

describe('forceFirstTool', () => {
  it('força a tool no step 0 e libera do step 1 em diante', async () => {
    await callWith({ forceFirstTool: 'search_knowledge' });

    const prepareStep = capturedPrepareStep();
    expect(prepareStep, 'prepareStep precisa chegar ao generateText').toBeTypeOf('function');

    // Step 0: obrigado a buscar no acervo.
    expect(prepareStep!({ stepNumber: 0 })).toEqual({
      toolChoice: { type: 'tool', toolName: 'search_knowledge' },
    });

    // Steps seguintes: livre — senão o modelo repetiria a busca até estourar
    // maxSteps e nunca produziria resposta.
    expect(prepareStep!({ stepNumber: 1 })).toEqual({});
    expect(prepareStep!({ stepNumber: 5 })).toEqual({});
  });

  it('NÃO força tool ausente do ToolSet (agente sem KB ativa)', async () => {
    await callWith({ forceFirstTool: 'search_knowledge', tools: { send_message: TOOLS } });

    expect(
      capturedPrepareStep(),
      'forçar tool inexistente derrubaria o turno no provider',
    ).toBeUndefined();
  });

  it('sem forceFirstTool não passa prepareStep (demais call sites intocados)', async () => {
    await callWith({});

    expect(capturedPrepareStep()).toBeUndefined();
  });
});
