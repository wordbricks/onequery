import { IconLoader2, IconSearch } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { showDataSourceErrorToast } from "@/features/data-sources/data-source-error-toast";
import {
  githubRepositoriesQueryOptions,
  updateGitHubRepositoriesMutationOptions,
} from "@/queries/github-repositories-queries";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Checkbox } from "@/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Input } from "@/ui/input";
import { ScrollArea } from "@/ui/scroll-area";

type GitHubRepositoriesDialogProps = {
  organizationId: string;
  dataSourceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function hasSelectionChanged(current: string[], initial: string[]): boolean {
  if (current.length !== initial.length) {
    return true;
  }
  const currentSet = new Set(current);
  return initial.some((repo) => !currentSet.has(repo));
}

export function GitHubRepositoriesDialog(props: GitHubRepositoriesDialogProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const hasInitialized = useRef(false);
  const queryClient = useQueryClient();

  const repositoriesQuery = useQuery({
    ...githubRepositoriesQueryOptions(props.organizationId, props.dataSourceId),
    enabled: props.open,
  });

  const repositories = repositoriesQuery.data?.repositories ?? [];
  const initialSelected = repositoriesQuery.data?.selected ?? [];

  useEffect(() => {
    if (!props.open) {
      hasInitialized.current = false;
      setSearch("");
      return;
    }

    if (!repositoriesQuery.data) {
      return;
    }

    if (hasInitialized.current) {
      return;
    }

    setSelected(initialSelected);
    hasInitialized.current = true;
  }, [initialSelected, props.open, repositoriesQuery.data]);

  const filteredRepositories = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) {
      return repositories;
    }
    return repositories.filter((repo) => {
      const owner = repo.owner.toLowerCase();
      const name = repo.name.toLowerCase();
      const fullName = repo.fullName.toLowerCase();
      return (
        owner.includes(term) || name.includes(term) || fullName.includes(term)
      );
    });
  }, [repositories, search]);

  const isChanged = useMemo(
    () => hasSelectionChanged(selected, initialSelected),
    [initialSelected, selected]
  );

  const updateMutation = useMutation(
    updateGitHubRepositoriesMutationOptions({
      dataSourceId: props.dataSourceId,
      onError: (error) => {
        showDataSourceErrorToast({
          title: "Failed to update GitHub repositories",
          description: error.message,
        });
      },
      onSuccess: () => {
        toast.success("GitHub repositories updated");
        props.onOpenChange(false);
      },
      organizationId: props.organizationId,
      queryClient,
    })
  );

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleRepository(fullName: string) {
    setSelected((current) => {
      if (current.includes(fullName)) {
        return current.filter((repo) => repo !== fullName);
      }
      return [...current, fullName];
    });
  }

  function selectAllVisible() {
    const visible = filteredRepositories.map((repo) => repo.fullName);
    setSelected((current) => [...new Set([...current, ...visible])]);
  }

  function clearSelection() {
    setSelected([]);
  }

  const isLoading = repositoriesQuery.isLoading;
  const isError = repositoriesQuery.isError;
  const canSave = isChanged && !updateMutation.isPending;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>Select GitHub Repositories</DialogTitle>
          <DialogDescription>
            Choose repositories to use for this data source. We only read from
            the repositories your saved token can access and that you select
            here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <IconSearch
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search repositories..."
                className="pl-9"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={selectAllVisible}
              disabled={filteredRepositories.length === 0}
            >
              Select visible
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              disabled={selected.length === 0}
            >
              Clear
            </Button>
          </div>

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {selected.length} selected
              {repositories.length > 0
                ? ` • ${repositories.length} available`
                : ""}
            </span>
            {isChanged ? <Badge variant="outline">Unsaved</Badge> : null}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <IconLoader2 size={24} className="animate-spin" />
            </div>
          ) : null}

          {isError ? (
            <p className="text-sm text-destructive">
              Unable to load repositories. Please try again.
            </p>
          ) : null}

          {!isLoading && !isError ? (
            <ScrollArea className="h-[320px] rounded-md border">
              <div className="p-2 space-y-1">
                {filteredRepositories.length === 0 ? (
                  <p className="text-sm text-muted-foreground px-3 py-6 text-center">
                    No repositories found.
                  </p>
                ) : null}
                {filteredRepositories.map((repo) => {
                  const isChecked = selectedSet.has(repo.fullName);
                  return (
                    <button
                      key={repo.id}
                      type="button"
                      className="w-full flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent transition-colors text-left"
                      onClick={(event) => {
                        const target = event.target;
                        if (!(target instanceof HTMLElement)) {
                          return;
                        }
                        if (target.closest('[data-slot="checkbox"]')) {
                          return;
                        }
                        toggleRepository(repo.fullName);
                      }}
                    >
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={() => toggleRepository(repo.fullName)}
                      />
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{repo.fullName}</span>
                          {repo.private ? (
                            <Badge variant="secondary">Private</Badge>
                          ) : null}
                        </div>
                        <span className="text-xs text-muted-foreground">
                          Owner: {repo.owner}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => props.onOpenChange(false)}
            disabled={updateMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => updateMutation.mutate({ repositories: selected })}
            disabled={!canSave}
          >
            {updateMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
