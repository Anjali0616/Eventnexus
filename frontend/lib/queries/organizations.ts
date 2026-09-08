import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  organizationsApi,
  coHostInvitationsApi,
  type Organization,
  type CoHostOrganization,
} from "../api/organizations";
import { useHasToken } from "../hooks/use-has-token";
import { useCurrentUser } from "./auth";
import { getErrorMessage } from "../errors";

export const organizationKeys = {
  list: ["organizations", "list"] as const,
  mine: ["organizations", "mine"] as const,
  coHosts: (eventId: string) => ["organizations", "co-hosts", eventId] as const,
};

export function useOrganizations() {
  return useQuery({
    queryKey: organizationKeys.list,
    queryFn: organizationsApi.list,
  });
}

export function useMyOrganization() {
  const hasToken = useHasToken();
  const { data: userData } = useCurrentUser();
  const currentUser = (userData as { user?: { role?: string; organization?: string } } | undefined)?.user;
  const canAccess = !!currentUser && !!currentUser.organization && (currentUser.role === "admin" || currentUser.role === "org_admin");
  return useQuery({
    queryKey: organizationKeys.mine,
    queryFn: organizationsApi.getMine,
    retry: false,
    enabled: hasToken && canAccess,
  });
}

export function useUpdateMyOrganization() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Pick<Organization, "name" | "status">>) =>
      organizationsApi.updateMine(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.mine });
      toast.success("Organization updated.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to update organization.")),
  });
}

// Co-host queries
export function useCoHostOrganizations(eventId: string) {
  const hasToken = useHasToken();
  const { data: userData } = useCurrentUser();
  const currentUser = (userData as { user?: { role?: string; organization?: string } } | undefined)?.user;
  const canAccess = !!currentUser && currentUser.role !== "attendee" && !!currentUser.organization;
  return useQuery({
    queryKey: organizationKeys.coHosts(eventId),
    queryFn: () => organizationsApi.listCoHosts(eventId),
    enabled: !!eventId && hasToken && canAccess,
    retry: false,
  });
}

export function useRemoveCoHostOrganization(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) => organizationsApi.removeCoHost(eventId, orgId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: organizationKeys.coHosts(eventId) });
      queryClient.invalidateQueries({ queryKey: invitationKeys.forEvent(eventId) });
      toast.success("Co-host removed.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to remove co-host.")),
  });
}

// --- Co-host invitations ----------------------------------------------------

export const invitationKeys = {
  forEvent: (eventId: string) => ["co-host-invitations", "event", eventId] as const,
  mine: ["co-host-invitations", "mine"] as const,
};

// Invitations this event has sent (pending / accepted / declined / cancelled).
export function useEventInvitations(eventId: string) {
  const hasToken = useHasToken();
  const { data: userData } = useCurrentUser();
  const currentUser = (userData as { user?: { role?: string } } | undefined)?.user;
  const canAccess = !!currentUser && currentUser.role !== "attendee";
  return useQuery({
    queryKey: invitationKeys.forEvent(eventId),
    queryFn: () => coHostInvitationsApi.listForEvent(eventId),
    enabled: !!eventId && hasToken && canAccess,
    retry: false,
  });
}

export function useInviteCoHost(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ organizationId, message }: { organizationId: string; message: string }) =>
      coHostInvitationsApi.invite(eventId, organizationId, message),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invitationKeys.forEvent(eventId) });
      toast.success("Co-host invitation sent.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to send invitation.")),
  });
}

export function useCancelInvitation(eventId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) => coHostInvitationsApi.cancel(eventId, invitationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: invitationKeys.forEvent(eventId) });
      toast.success("Invitation cancelled.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to cancel invitation.")),
  });
}

// The caller's own organization's inbox, across every event.
export function useMyInvitations() {
  const hasToken = useHasToken();
  const { data: userData } = useCurrentUser();
  const currentUser = (userData as { user?: { role?: string } } | undefined)?.user;
  const canAccess = !!currentUser && currentUser.role !== "attendee";
  return useQuery({
    queryKey: invitationKeys.mine,
    queryFn: coHostInvitationsApi.listMine,
    enabled: hasToken && canAccess,
    retry: false,
  });
}

export function useRespondToInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      invitationId,
      action,
      message,
    }: {
      invitationId: string;
      action: "accept" | "decline";
      message?: string;
    }) => coHostInvitationsApi.respond(invitationId, action, message),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: invitationKeys.mine });
      queryClient.invalidateQueries({ queryKey: ["organizations", "co-hosts"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(vars.action === "accept" ? "Invitation accepted! You are now co-host." : "Invitation declined.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to respond to invitation.")),
  });
}
