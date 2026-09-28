import { createContext, useContext, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getOpsControl,
  updateOpsControl,
  type BlockedScope,
  type OpsControlState,
} from "@/lib/ops-control";

const OPS_CONTROL_KEY = ["ops-control"] as const;

interface OpsControlContextValue {
  state: OpsControlState | undefined;
  isLoading: boolean;
  isError: boolean;
  isUpdating: boolean;
  controlsBlocked: boolean;
  isScopeBlocked: (scope: BlockedScope) => boolean;
  refetch: () => void;
  stop: (reason: string) => Promise<OpsControlState>;
  resume: () => Promise<OpsControlState>;
}

const OpsControlContext = createContext<OpsControlContextValue | null>(null);

export function useOpsControl(): OpsControlContextValue {
  const value = useContext(OpsControlContext);
  if (!value)
    throw new Error("useOpsControl must be used inside OpsControlProvider");
  return value;
}

export function OpsControlProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const controlQuery = useQuery({
    queryKey: OPS_CONTROL_KEY,
    queryFn: getOpsControl,
    retry: 1,
    refetchInterval: 5_000,
    refetchOnWindowFocus: "always",
  });
  const mutation = useMutation({
    mutationFn: updateOpsControl,
    onSuccess: (state) => queryClient.setQueryData(OPS_CONTROL_KEY, state),
  });

  const unavailable = controlQuery.isPending || controlQuery.isError;
  const state = controlQuery.data;
  const context: OpsControlContextValue = {
    state,
    isLoading: controlQuery.isPending,
    isError: controlQuery.isError,
    isUpdating: mutation.isPending,
    controlsBlocked: unavailable || Boolean(state?.emergencyStopEnabled),
    isScopeBlocked: (scope) =>
      unavailable ||
      Boolean(
        state?.emergencyStopEnabled && state.blockedScopes.includes(scope),
      ),
    refetch: () => void controlQuery.refetch(),
    stop: (reason) =>
      mutation.mutateAsync({ emergencyStopEnabled: true, reason }),
    resume: () => mutation.mutateAsync({ emergencyStopEnabled: false }),
  };

  return (
    <OpsControlContext.Provider value={context}>
      {children}
    </OpsControlContext.Provider>
  );
}
