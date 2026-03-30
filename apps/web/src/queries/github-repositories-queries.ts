import { mutationOptions, queryOptions } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { createApiClient } from "@/lib/api-client";
import { getApiErrorMessage } from "@/queries/api-error";

type GitHubRepository = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  owner: string;
};

type GitHubRepositoriesResponse = {
  repositories: GitHubRepository[];
  selected: string[];
};

type UpdateGitHubRepositoriesInput = {
  repositories: string[];
};

const client = createApiClient();

async function fetchGitHubRepositories(
  organizationId: string,
  dataSourceId: string
): Promise<GitHubRepositoriesResponse> {
  const response = await client.api["data-sources"][":id"][
    "github-repositories"
  ].$get({
    param: { id: dataSourceId },
    query: { organizationId },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      getApiErrorMessage(error, "Failed to fetch GitHub repositories")
    );
  }

  return response.json();
}

export function githubRepositoriesQueryOptions(
  organizationId: string,
  dataSourceId: string
) {
  return queryOptions({
    queryFn: async () => fetchGitHubRepositories(organizationId, dataSourceId),
    queryKey: ["github-repositories", dataSourceId] as const,
  });
}

async function updateGitHubRepositories(
  organizationId: string,
  dataSourceId: string,
  repositories: string[]
): Promise<{ success: boolean; repositories: string[] }> {
  const response = await client.api["data-sources"][":id"][
    "github-repositories"
  ].$post({
    json: { repositories },
    param: { id: dataSourceId },
    query: { organizationId },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => null);
    throw new Error(
      getApiErrorMessage(error, "Failed to update GitHub repositories")
    );
  }

  return response.json();
}

type UpdateGitHubRepositoriesMutationOptionsInput = {
  queryClient: QueryClient;
  organizationId: string;
  dataSourceId: string;
  onSuccess?: (
    data: { success: boolean; repositories: string[] },
    variables: UpdateGitHubRepositoriesInput
  ) => void;
  onError?: (error: Error, variables: UpdateGitHubRepositoriesInput) => void;
};

export function updateGitHubRepositoriesMutationOptions({
  queryClient,
  organizationId,
  dataSourceId,
  onSuccess,
  onError,
}: UpdateGitHubRepositoriesMutationOptionsInput) {
  const repositoriesQuery = githubRepositoriesQueryOptions(
    organizationId,
    dataSourceId
  );

  return mutationOptions({
    mutationFn: async (variables: UpdateGitHubRepositoriesInput) =>
      updateGitHubRepositories(
        organizationId,
        dataSourceId,
        variables.repositories
      ),
    mutationKey: ["github-repositories", dataSourceId, "update"] as const,
    onError,
    onSuccess: (data, variables) => {
      queryClient.setQueryData<GitHubRepositoriesResponse | undefined>(
        repositoriesQuery.queryKey,
        (current) => {
          if (!current) {
            return current;
          }

          return {
            ...current,
            selected: data.repositories,
          };
        }
      );
      onSuccess?.(data, variables);
    },
  });
}
