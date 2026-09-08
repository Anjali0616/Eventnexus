import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { collaborationApi } from "../api/collaboration";
import { useHasToken } from "../hooks/use-has-token";
import { useCurrentUser } from "./auth";
import { getErrorMessage } from "../errors";

export const collaborationKeys = {
  all: ["collaboration", "suggestions"] as const,
};

export function useCollaborationSuggestions() {
  const hasToken = useHasToken();
  const { data: userData } = useCurrentUser();
  const currentUser = (userData as { user?: { role?: string } } | undefined)?.user;
  const canAccess = !!currentUser && currentUser.role !== "attendee";
  return useQuery({
    queryKey: collaborationKeys.all,
    queryFn: collaborationApi.list,
    retry: false,
    enabled: hasToken && canAccess,
  });
}

// Re-run the AI match scan for the organization's events.
export function useGenerateSuggestions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: collaborationApi.generate,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.all });
      const created = (data as { created?: unknown[] })?.created?.length ?? 0;
      toast.success(created ? `Found ${created} new collaboration matches!` : "No new matches found.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to generate suggestions.")),
  });
}

export function useAcceptSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => collaborationApi.accept(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.all });
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["organizations", "co-hosts"] });
      toast.success("Collaboration accepted!");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to accept suggestion.")),
  });
}

export function useDeclineSuggestion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => collaborationApi.decline(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: collaborationKeys.all });
      toast.success("Suggestion declined.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to decline suggestion.")),
  });
}