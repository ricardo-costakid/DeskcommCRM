"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { apiClient } from "@/lib/api/client";
import { showApiError } from "@/components/feedback/ApiErrorToast";
import type { TeamMember } from "@/hooks/team/useTeamMembers";
import type { Department } from "@/lib/schemas/team";

const MEMBERS_KEY = ["team", "members"] as const;

/** Optimistic department change: cache updated on mutate, rolled back on error. */
export function useUpdateMemberDepartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { userId: string; department: Department }) =>
      apiClient.patch<{ data: { user_id: string; department: Department } }>(
        `/api/v1/team/${args.userId}/department`,
        { department: args.department },
      ),
    onMutate: async ({ userId, department }) => {
      await qc.cancelQueries({ queryKey: MEMBERS_KEY });
      const previous = qc.getQueryData<{ data: TeamMember[] }>(MEMBERS_KEY);
      qc.setQueryData<{ data: TeamMember[] }>(MEMBERS_KEY, (old) =>
        old
          ? {
              ...old,
              data: old.data.map((m) => (m.user_id === userId ? { ...m, department } : m)),
            }
          : old,
      );
      return { previous };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) qc.setQueryData(MEMBERS_KEY, context.previous);
      showApiError(err);
    },
    onSuccess: () => {
      toast.success("Função atualizada.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });
}
