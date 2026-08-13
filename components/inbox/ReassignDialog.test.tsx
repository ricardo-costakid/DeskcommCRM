/**
 * ReassignDialog — lista de destinos da transferência.
 *
 * Antes desta mudança, a opção mostrava sempre "Atendente <ID> · <Role>".
 * Agora mostra "<Nome> · <Função>" quando o membro tem full_name/department
 * preenchidos, com fallback pro role RBAC quando department é null, e pro
 * "Atendente <ID>" quando nem full_name existe.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type { AssignableMember } from "@/hooks/inbox/useAssignableMembers";

vi.mock("@/lib/api/client", () => ({
  apiClient: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() },
}));
vi.mock("@/hooks/auth/AuthProvider", () => ({
  useAuth: () => ({ user: { id: "me-1" } }),
}));

import { apiClient } from "@/lib/api/client";
import { ReassignDialog } from "./ReassignDialog";

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
window.HTMLElement.prototype.setPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

function members(): AssignableMember[] {
  return [
    { user_id: "u-com-nome-e-funcao", role: "agent", department: "psicologo", full_name: "Ana Souza" },
    { user_id: "u-so-role", role: "manager", department: null, full_name: "Beto Lima" },
    { user_id: "u-sem-nada", role: "agent", department: null, full_name: null },
  ];
}

function renderDialog() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReassignDialog conversationId="conv-1" open={true} onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiClient.get).mockResolvedValue({ data: members() });
});

describe("ReassignDialog — rótulo de cada destino", () => {
  it("nome + função quando ambos preenchidos", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole("combobox", { name: /transferir para/i }));
    expect(await screen.findByRole("option", { name: /Ana Souza\s*·\s*Psicólogo/ })).toBeInTheDocument();
  });

  it("nome sem função → cai no role RBAC, não em 'Atendente <ID>'", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole("combobox", { name: /transferir para/i }));
    expect(await screen.findByRole("option", { name: /Beto Lima\s*·\s*Gestor/ })).toBeInTheDocument();
  });

  it("sem nome nem função → fallback 'Atendente <ID>' · role", async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(await screen.findByRole("combobox", { name: /transferir para/i }));
    expect(
      await screen.findByRole("option", { name: /Atendente u-sem-na\s*·\s*Atendente/ }),
    ).toBeInTheDocument();
  });
});
