import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  compileRuleset,
  createPlanningTeamIdBySlug,
  createSyncPlan,
  rulesetsMatch,
} from "./index";
import type {
  CompiledRulesetPayload,
  ExistingRuleset,
  PlanItem,
  RulesetSpec,
  SyncPlan,
  TeamMembershipUpdate,
  TeamSpec,
} from "./index";

type RepoInfo = {
  name: string;
  defaultBranch: string;
  nameWithOwner: string;
  owner: {
    login: string;
    type: string;
  };
};

type IntegrationInfo = {
  id: number;
  slug: string;
};

type TeamInfo = {
  id: number;
  slug: string;
  name: string;
};

type RulesetListEntry = {
  id: number;
  name: string;
};

type TeamDirectory = {
  teams: TeamSpec[];
};

type Command = "check" | "apply" | "plan";

type SyncSnapshot = {
  repo: RepoInfo;
  teamDirectory: TeamDirectory;
  rulesetSpecs: RulesetSpec[];
  teamIdBySlug: Map<string, number>;
  missingTeamSlugs: string[];
  teamMembershipUpdates: TeamMembershipUpdate[];
  integrationIdBySlug: Map<string, number>;
  existingRulesets: ExistingRuleset[];
  desiredRulesetsForPlan: CompiledRulesetPayload[];
};

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = resolve(PACKAGE_ROOT, "..", "..");
const RULESET_DIR = resolve(REPO_ROOT, ".github", "rulesets");
const GH_API_VERSION = "2022-11-28";
const GITHUB_ACTIONS_SLUG = "github-actions";

const command = parseCommand(process.argv.slice(2));
const authToken = readGhToken();
await run(command);

function parseCommand(args: string[]): Command {
  if (args.includes("--plan")) {
    return "plan";
  }

  if (args.includes("--apply")) {
    return "apply";
  }

  if (args.length === 0 || args.includes("--check")) {
    return "check";
  }

  throw new Error(
    `Unknown arguments: ${args.join(" ")}. Use --check, --plan, or --apply.`
  );
}

async function run(command: Command): Promise<void> {
  const snapshot = await collectSyncSnapshot();
  const plan = createSyncPlan({
    repoNameWithOwner: snapshot.repo.nameWithOwner,
    teamIdBySlug: snapshot.teamIdBySlug,
    missingTeamSlugs: snapshot.missingTeamSlugs,
    teamMembershipUpdates: snapshot.teamMembershipUpdates,
    integrationIdBySlug: snapshot.integrationIdBySlug,
    existingRulesets: snapshot.existingRulesets,
    desiredRulesetsForPlan: snapshot.desiredRulesetsForPlan,
  });

  if (command === "plan") {
    printPlannedChanges(plan.repoNameWithOwner, plan.items);
    console.log(
      plan.items.length === 0
        ? `GitHub rulesets are already in sync for ${plan.repoNameWithOwner}.`
        : `GitHub ruleset plan generated for ${plan.repoNameWithOwner}.`
    );
    return;
  }

  if (plan.drift.length > 0) {
    printPlannedChanges(plan.repoNameWithOwner, plan.items);
  }

  if (command === "check" && plan.drift.length > 0) {
    throw new Error(plan.drift.join("\n"));
  }

  if (command === "apply") {
    await applySyncPlan(snapshot, plan);
  }

  console.log(
    command === "apply"
      ? `GitHub rulesets are synced for ${plan.repoNameWithOwner}.`
      : `GitHub rulesets are in sync for ${plan.repoNameWithOwner}.`
  );
}

async function collectSyncSnapshot(): Promise<SyncSnapshot> {
  const repo = await getRepoInfo();
  const teamDirectory = readJsonFile<TeamDirectory>(
    resolve(RULESET_DIR, "teams.json")
  );

  if (repo.owner.type !== "Organization") {
    throw new Error(
      `GitHub ruleset sync expects an organization-owned repository, got ${repo.owner.type} (${repo.nameWithOwner}).`
    );
  }

  const { teamIds: teamIdBySlug, missingTeamSlugs } = await collectTeamIds(
    repo.owner.login,
    teamDirectory.teams
  );
  const teamMembershipUpdates: TeamMembershipUpdate[] = [];

  for (const team of teamDirectory.teams) {
    if (missingTeamSlugs.includes(team.slug)) {
      continue;
    }

    const missingMembers = await getMissingTeamMembers(repo.owner.login, team);
    if (missingMembers.length > 0) {
      teamMembershipUpdates.push({ team, missingMembers });
    }
  }

  const integrationIdBySlug = await collectIntegrationIds(repo);
  const rulesetSpecs = await loadRulesetSpecs();
  const teamIdBySlugForPlan = createPlanningTeamIdBySlug(
    teamIdBySlug,
    missingTeamSlugs
  );
  const desiredRulesetsForPlan = rulesetSpecs.map((spec) =>
    compileRuleset(spec, teamIdBySlugForPlan, integrationIdBySlug)
  );
  const existingRulesets = await listExistingRulesets(repo);

  return {
    repo,
    teamDirectory,
    rulesetSpecs,
    teamIdBySlug,
    missingTeamSlugs,
    teamMembershipUpdates,
    integrationIdBySlug,
    existingRulesets,
    desiredRulesetsForPlan,
  };
}

function printPlannedChanges(
  repoNameWithOwner: string,
  items: PlanItem[]
): void {
  console.log(`GitHub ruleset change plan for ${repoNameWithOwner}:`);

  if (items.length === 0) {
    console.log("  (no changes)");
    return;
  }

  for (const item of items) {
    console.log(`- ${item.summary}`);
    for (const detail of item.details ?? []) {
      console.log(`  - ${detail}`);
    }
  }
}

function readGhToken(): string {
  const token = execFileSync("gh", ["auth", "token"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  }).trim();

  if (!token) {
    throw new Error("`gh auth token` returned an empty token.");
  }

  return token;
}

async function getRepoInfo(): Promise<RepoInfo> {
  const repoView = JSON.parse(
    execFileSync(
      "gh",
      ["repo", "view", "--json", "name,nameWithOwner,defaultBranchRef,owner"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }
    )
  ) as {
    name: string;
    nameWithOwner: string;
    defaultBranchRef: {
      name: string;
    };
    owner: {
      login: string;
    };
  };

  const repoDetails = await githubRequest<{
    owner: {
      type: string;
    };
  }>(`repos/${repoView.nameWithOwner}`);

  return {
    name: repoView.name,
    defaultBranch: repoView.defaultBranchRef.name,
    nameWithOwner: repoView.nameWithOwner,
    owner: {
      login: repoView.owner.login,
      type: repoDetails.owner.type,
    },
  };
}

async function loadRulesetSpecs(): Promise<RulesetSpec[]> {
  const files = readdirSync(RULESET_DIR)
    .filter((file) => file.endsWith(".json") && file !== "teams.json")
    .sort()
    .map((file) => resolve(RULESET_DIR, file));

  return files.map((path) => readJsonFile<RulesetSpec>(path));
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

async function ensureTeams(org: string, teams: TeamSpec[]): Promise<void> {
  for (const team of teams) {
    const response = await githubRequestRaw(`orgs/${org}/teams/${team.slug}`, {
      method: "GET",
      allow404: true,
    });

    if (response.status !== 404) {
      continue;
    }

    await githubRequest(`orgs/${org}/teams`, {
      method: "POST",
      body: {
        name: team.name,
        privacy: team.privacy,
      },
    });
  }
}

async function collectTeamIds(
  org: string,
  teams: TeamSpec[]
): Promise<{ teamIds: Map<string, number>; missingTeamSlugs: string[] }> {
  const teamIds = new Map<string, number>();
  const missingTeamSlugs: string[] = [];

  for (const team of teams) {
    const response = await githubRequestRaw(`orgs/${org}/teams/${team.slug}`, {
      method: "GET",
      allow404: true,
    });

    if (response.status === 404) {
      missingTeamSlugs.push(team.slug);
      continue;
    }

    const teamInfo = (await response.json()) as TeamInfo;
    teamIds.set(team.slug, teamInfo.id);
  }

  return {
    teamIds,
    missingTeamSlugs,
  };
}

async function getMissingTeamMembers(
  org: string,
  team: TeamSpec
): Promise<string[]> {
  const missingMembers: string[] = [];

  for (const username of team.members) {
    const response = await githubRequestRaw(
      `orgs/${org}/teams/${team.slug}/memberships/${username}`,
      {
        method: "GET",
        allow404: true,
      }
    );

    if (response.status === 404) {
      missingMembers.push(username);
    }
  }

  return missingMembers;
}

async function ensureTeamMembers(
  org: string,
  team: TeamSpec,
  missingMembers: string[]
): Promise<void> {
  for (const username of missingMembers) {
    await githubRequest(
      `orgs/${org}/teams/${team.slug}/memberships/${username}`,
      {
        method: "PUT",
        body: {
          role: "member",
        },
      }
    );
  }
}

async function collectIntegrationIds(
  repo: RepoInfo
): Promise<Map<string, number>> {
  const integrationIds = new Map<string, number>();
  integrationIds.set(
    GITHUB_ACTIONS_SLUG,
    await resolveGitHubActionsIntegrationId(repo)
  );
  return integrationIds;
}

async function resolveGitHubActionsIntegrationId(
  repo: RepoInfo
): Promise<number> {
  const envOverride = process.env.GITHUB_ACTIONS_INTEGRATION_ID;
  if (envOverride) {
    const parsed = Number(envOverride);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(
        `Invalid GITHUB_ACTIONS_INTEGRATION_ID: expected a positive integer, got ${envOverride}`
      );
    }
    return parsed;
  }

  const branch = await githubRequest<{
    commit: {
      sha: string;
    };
  }>(`repos/${repo.nameWithOwner}/branches/${repo.defaultBranch}`);
  const checkRuns = await githubRequest<{
    check_runs: Array<{
      app?: IntegrationInfo;
    }>;
  }>(
    `repos/${repo.nameWithOwner}/commits/${branch.commit.sha}/check-runs?per_page=100`
  );

  const actionsRun = checkRuns.check_runs.find(
    (checkRun) => checkRun.app?.slug === GITHUB_ACTIONS_SLUG
  );

  if (!actionsRun?.app?.id) {
    throw new Error(
      `Could not resolve the GitHub Actions integration ID from recent check runs on ${repo.defaultBranch}. Set GITHUB_ACTIONS_INTEGRATION_ID to override.`
    );
  }

  return actionsRun.app.id;
}

async function listExistingRulesets(
  repo: RepoInfo
): Promise<ExistingRuleset[]> {
  const rulesets = await githubRequest<RulesetListEntry[]>(
    `repos/${repo.nameWithOwner}/rulesets?includes_parents=false`
  );

  const detailedRulesets = await Promise.all(
    rulesets.map((ruleset) =>
      githubRequest<ExistingRuleset>(
        `repos/${repo.nameWithOwner}/rulesets/${ruleset.id}`
      )
    )
  );

  return detailedRulesets;
}

async function applySyncPlan(
  snapshot: SyncSnapshot,
  plan: SyncPlan
): Promise<void> {
  if (plan.missingTeamSlugs.length > 0) {
    await ensureTeams(snapshot.repo.owner.login, snapshot.teamDirectory.teams);
  }

  const {
    teamIds: applyTeamIdBySlug,
    missingTeamSlugs: postCreateMissingTeamSlugs,
  } = await collectTeamIds(
    snapshot.repo.owner.login,
    snapshot.teamDirectory.teams
  );

  if (postCreateMissingTeamSlugs.length > 0) {
    throw new Error(
      `Teams still missing after apply: ${postCreateMissingTeamSlugs.join(", ")}`
    );
  }

  for (const teamMembershipUpdate of plan.teamMembershipUpdates) {
    await ensureTeamMembers(
      snapshot.repo.owner.login,
      teamMembershipUpdate.team,
      teamMembershipUpdate.missingMembers
    );
  }

  const desiredRulesets = snapshot.rulesetSpecs.map((spec) =>
    compileRuleset(spec, applyTeamIdBySlug, snapshot.integrationIdBySlug)
  );
  const existingRulesetByName = new Map(
    snapshot.existingRulesets.map((ruleset) => [ruleset.name, ruleset] as const)
  );

  for (const desiredRuleset of desiredRulesets) {
    const existingRuleset = existingRulesetByName.get(desiredRuleset.name);

    if (!existingRuleset) {
      await createRuleset(snapshot.repo, desiredRuleset);
      continue;
    }

    if (!rulesetsMatch(existingRuleset, desiredRuleset)) {
      await updateRuleset(snapshot.repo, existingRuleset.id, desiredRuleset);
    }
  }

  await verifyAppliedRulesets(snapshot.repo, desiredRulesets);

  if (plan.drift.length > 0) {
    console.log(plan.drift.join("\n"));
  }
}

async function verifyAppliedRulesets(
  repo: RepoInfo,
  desiredRulesets: CompiledRulesetPayload[]
): Promise<void> {
  const postApplyRulesets = await listExistingRulesets(repo);
  const postApplyMap = new Map(
    postApplyRulesets.map((ruleset) => [ruleset.name, ruleset] as const)
  );

  const postApplyDrift = desiredRulesets
    .filter((desiredRuleset) => {
      const existingRuleset = postApplyMap.get(desiredRuleset.name);
      return (
        !existingRuleset || !rulesetsMatch(existingRuleset, desiredRuleset)
      );
    })
    .map((ruleset) => `Post-apply drift remains: ${ruleset.name}`);

  if (postApplyDrift.length > 0) {
    throw new Error(postApplyDrift.join("\n"));
  }
}

async function createRuleset(
  repo: RepoInfo,
  ruleset: CompiledRulesetPayload
): Promise<void> {
  await githubRequest(`repos/${repo.nameWithOwner}/rulesets`, {
    method: "POST",
    body: ruleset,
  });
}

async function updateRuleset(
  repo: RepoInfo,
  rulesetId: number,
  ruleset: CompiledRulesetPayload
): Promise<void> {
  await githubRequest(`repos/${repo.nameWithOwner}/rulesets/${rulesetId}`, {
    method: "PUT",
    body: ruleset,
  });
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  allow404?: boolean;
};

async function githubRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const response = await githubRequestRaw(path, options);

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `GitHub API request failed (${options.method ?? "GET"} ${path}): ${response.status} ${response.statusText}\n${errorBody}`
    );
  }

  return (await response.json()) as T;
}

async function githubRequestRaw(
  path: string,
  options: RequestOptions = {}
): Promise<Response> {
  const response = await fetch(`https://api.github.com/${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${authToken}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GH_API_VERSION,
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (response.status === 404 && options.allow404) {
    return response;
  }

  return response;
}
