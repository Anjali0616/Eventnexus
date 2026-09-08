import {
  useMutation,
  useQuery,
  useQueryClient,
  keepPreviousData,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { sessionsApi, type CreateSessionPayload, type SessionData } from "../api/sessions";
import { speakersApi, type CreateSpeakerPayload, type SpeakerData } from "../api/sessions";
import { useHasToken } from "../hooks/use-has-token";
import { useCurrentUser } from "./auth";
import { getErrorMessage } from "../errors";

export const sessionKeys = {
  byEvent: (eventId: string) => ["sessions", "byEvent", eventId] as const,
  detail: (id: string) => ["sessions", "detail", id] as const,
};

export const speakerKeys = {
  list: ["speakers", "list"] as const,
  detail: (id: string) => ["speakers", "detail", id] as const,
};

export function useEventSessions(eventId: string) {
  return useQuery({
    queryKey: sessionKeys.byEvent(eventId),
    queryFn: () => sessionsApi.getByEvent(eventId),
    enabled: useHasToken() && !!eventId,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

export function useSession(id: string) {
  return useQuery({
    queryKey: sessionKeys.detail(id),
    queryFn: () => sessionsApi.getById(id),
    enabled: useHasToken() && !!id,
  });
}

export function useCreateSession(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSessionPayload) => sessionsApi.create(eventId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.byEvent(eventId) });
      toast.success("Session created.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to create session.")),
  });
}

export function useUpdateSession(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateSessionPayload> & { status?: SessionData["status"] };
    }) => sessionsApi.update(eventId, id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.byEvent(eventId) });
      queryClient.invalidateQueries({ queryKey: sessionKeys.detail(variables.id) });
      toast.success("Session updated.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to update session.")),
  });
}

export function useDeleteSession(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sessionsApi.delete(eventId, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sessionKeys.byEvent(eventId) });
      toast.success("Session deleted.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to delete session.")),
  });
}

export function useOrganizationSpeakers(opts?: { enabled?: boolean }) {
  const hasToken = useHasToken();
  const { data: userData } = useCurrentUser();
  const currentUser = (userData as { user?: { role?: string; organization?: string } } | undefined)?.user;
  const canAccess = !!currentUser && !!currentUser.organization && currentUser.role !== "attendee";
  return useQuery({
    queryKey: speakerKeys.list,
    queryFn: () => speakersApi.list(),
    enabled: hasToken && canAccess && (opts?.enabled ?? true),
    retry: false,
  });
}

export function useSpeaker(id: string) {
  const hasToken = useHasToken();
  const { data: userData } = useCurrentUser();
  const currentUser = (userData as { user?: { role?: string; organization?: string } } | undefined)?.user;
  const canAccess = !!currentUser && !!currentUser.organization && currentUser.role !== "attendee";
  return useQuery({
    queryKey: speakerKeys.detail(id),
    queryFn: () => speakersApi.getById(id),
    enabled: hasToken && !!id && canAccess,
    retry: false,
  });
}

export function useCreateSpeaker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSpeakerPayload) => speakersApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: speakerKeys.list });
      toast.success("Speaker added.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to add speaker.")),
  });
}

export function useUpdateSpeaker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CreateSpeakerPayload> }) =>
      speakersApi.update(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: speakerKeys.list });
      queryClient.invalidateQueries({ queryKey: speakerKeys.detail(variables.id) });
      toast.success("Speaker updated.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to update speaker.")),
  });
}

export function useDeleteSpeaker() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => speakersApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: speakerKeys.list });
      toast.success("Speaker deleted.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to delete speaker.")),
  });
}
