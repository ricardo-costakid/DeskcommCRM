"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { ProvisionMembersInput } from "@/lib/schemas/team";

export interface ProvisionMemberResultDto {
  email: string;
  ok: boolean;
  password?: string;
  error?: "already_member" | "revoked_member" | "email_already_registered" | "provision_failed";
  message?: string;
}

interface ProvisionMembersResponse {
  data: { results: ProvisionMemberResultDto[] };
}

export function useProvisionMembers() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProvisionMembersInput) =>
      apiClient.post<ProvisionMembersResponse>("/api/v1/team/members", input),
    onError: showApiError,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}
