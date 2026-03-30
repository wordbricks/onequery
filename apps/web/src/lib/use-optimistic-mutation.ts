import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

type QueryKey = readonly unknown[];

interface UseOptimisticMutationOptions<TData, TVariables, TCacheData> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  queryKey: QueryKey;
  optimisticUpdate: (cache: TCacheData, variables: TVariables) => TCacheData;
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: Error, variables: TVariables) => void;
  successMessage?: string;
  errorMessage?: string;
}

interface UseOptimisticMutationReturn<TVariables> {
  mutate: (variables?: TVariables) => void;
  mutateAsync: (variables?: TVariables) => Promise<unknown>;
  isPending: boolean;
  isError: boolean;
  isSuccess: boolean;
}

function useOptimisticMutation<TData, TVariables = void, TCacheData = unknown>({
  mutationFn,
  queryKey,
  optimisticUpdate,
  onSuccess,
  onError,
  successMessage,
  errorMessage,
}: UseOptimisticMutationOptions<
  TData,
  TVariables,
  TCacheData
>): UseOptimisticMutationReturn<TVariables> {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn,
    onError: (error: Error, variables: TVariables, context) => {
      // If the mutation fails, use the context returned from onMutate to roll back
      if (context?.previousData !== undefined) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
      const message =
        errorMessage ?? (error.message ? error.message : "Operation failed");
      toast.error(message);
      onError?.(error, variables);
    },
    onMutate: async (variables: TVariables) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the previous value
      const previousData = queryClient.getQueryData<TCacheData>(queryKey);

      // Optimistically update to the new value
      if (previousData !== undefined) {
        queryClient.setQueryData<TCacheData>(queryKey, (old) => {
          if (old === undefined) return old;
          return optimisticUpdate(old, variables);
        });
      }

      // Return a context object with the snapshotted value
      return { previousData };
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey });
    },
    onSuccess: (data: TData, variables: TVariables) => {
      if (successMessage) {
        toast.success(successMessage);
      }
      onSuccess?.(data, variables);
    },
  });

  return {
    isError: mutation.isError,
    isPending: mutation.isPending,
    isSuccess: mutation.isSuccess,
    mutate: mutation.mutate as (variables?: TVariables) => void,
    mutateAsync: mutation.mutateAsync as (
      variables?: TVariables
    ) => Promise<unknown>,
  };
}

// Specialized hook for delete operations
interface UseOptimisticDeleteOptions<TData, TItem> {
  mutationFn: () => Promise<TData>;
  queryKey: QueryKey;
  itemId: string;
  getId?: (item: TItem) => string;
  onSuccess?: (data: TData) => void;
  onError?: (error: Error) => void;
  successMessage?: string;
  errorMessage?: string;
}

export function useOptimisticDelete<TData, TItem extends { id: string }>({
  mutationFn,
  queryKey,
  itemId,
  getId = (item) => item.id,
  onSuccess,
  onError,
  successMessage,
  errorMessage = "Failed to delete",
}: UseOptimisticDeleteOptions<TData, TItem>) {
  return useOptimisticMutation<TData, void, TItem[]>({
    errorMessage,
    mutationFn: async () => mutationFn(),
    onError: onError ? (error) => onError(error) : undefined,
    onSuccess: onSuccess ? (data) => onSuccess(data) : undefined,
    optimisticUpdate: (cache) => cache.filter((item) => getId(item) !== itemId),
    queryKey,
    successMessage,
  });
}

// Specialized hook for adding items optimistically
interface UseOptimisticAddOptions<TData, TVariables, TItem> {
  mutationFn: (variables: TVariables) => Promise<TData>;
  queryKey: QueryKey;
  createOptimisticItem: (variables: TVariables) => TItem;
  onSuccess?: (data: TData, variables: TVariables) => void;
  onError?: (error: Error, variables: TVariables) => void;
  successMessage?: string;
  errorMessage?: string;
}

export function useOptimisticAdd<TData, TVariables, TItem>({
  mutationFn,
  queryKey,
  createOptimisticItem,
  onSuccess,
  onError,
  successMessage,
  errorMessage,
}: UseOptimisticAddOptions<TData, TVariables, TItem>) {
  return useOptimisticMutation<TData, TVariables, TItem[]>({
    errorMessage,
    mutationFn,
    onError,
    onSuccess,
    optimisticUpdate: (cache, variables) => [
      ...cache,
      createOptimisticItem(variables),
    ],
    queryKey,
    successMessage,
  });
}
