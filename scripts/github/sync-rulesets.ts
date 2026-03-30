import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type BypassMode = "always" | "pull_request";
type RulesetTarget = "branch" | "tag";
type RulesetEnforcement = "active" | "disabled" | "evaluate";
type TeamPrivacy = "closed" | "secret";

type TeamSpec = {
  slug: string;
  name: string;
  privacy: TeamPrivacy;
  members: string[];
};

type IntegrationActorSpec = {
  actor_type: "Integration";
  actor_slug: "github-actions";
  bypass_mode?: BypassMode;
};

type TeamActorSpec = {
  actor_type: "Team";
  actor_slug: string;
  bypass_mode?: BypassMode;
};

type SpecBypassActor = IntegrationActorSpec | TeamActorSpec;

type RequiredStatusCheckSpec = {
  context: string;
  integration_slug?: "github-actions";
};

type RuleSpec =
  | { type: "creation" }
  | { type: "deletion" }
  | { type: "non_fast_forward" }
  | { type: "required_linear_history" }
  | {
      type: "update";
      parameters: {
        update_allows_fetch_and_merge: boolean;
      };
    }
  | {
      type: "pull_request";
      parameters: {
        allowed_merge_methods: Array<"merge" | "squash" | "rebase">;
        dismiss_stale_reviews_on_push: boolean;
        require_code_owner_review: boolean;
        require_last_push_approval: boolean;
        required_approving_review_count: number;
        required_review_thread_resolution: boolean;
      };
    }
  | {
      type: "required_status_checks";
      parameters: {
        do_not_enforce_on_create?: boolean;
        strict_required_status_checks_policy: boolean;
        required_status_checks: RequiredStatusCheckSpec[];
      };
    };

type RulesetSpec = {
  name: string;
  target: RulesetTarget;
  enforcement: RulesetEnforcement;
  conditions: {
    ref_name: {
      include: string[];
      exclude?: string[];
    };
  };
  bypass_actors: SpecBypassActor[];
  rules: RuleSpec[];
};

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

type CompiledBypassActor = {
  actor_id: number;
  actor_type: "Integration" | "Team";
  bypass_mode: BypassMode;
};

type CompiledRequiredStatusCheck = {
  context: string;
  integration_id?: number;
};

type CompiledRule =
  | { type: "creation" }
  | { type: "deletion" }
  | { type: "non_fast_forward" }
  | { type: "required_linear_history" }
  | {
      type: "update";
      parameters: {
        update_allows_fetch_and_merge: boolean;
      };
    }
  | {
      type: "pull_request";
      parameters: {
        allowed_merge_methods: Array<"merge" | "squash" | "rebase">;
        dismiss_stale_reviews_on_push: boolean;
        require_code_owner_review: boolean;
        require_last_push_approval: boolean;
        required_approving_review_count: number;
        required_review_thread_resolution: boolean;
      };
    }
  | {
      type: "required_status_checks";
      parameters: {
        do_not_enforce_on_create: boolean;
        strict_required_status_checks_policy: boolean;
        required_status_checks: CompiledRequiredStatusCheck[];
      };
    };

type CompiledRulesetPayload = {
  name: string;
  target: RulesetTarget;
  enforcement: RulesetEnforcement;
  conditions: {
    ref_name: {
      include: string[];
      exclude: string[];
    };
  };
  bypass_actors: CompiledBypassActor[];
  rules: CompiledRule[];
};

type RulesetListEntry = {
  id: number;
  name: string;
};

type ExistingRuleset = CompiledRulesetPayload & {
  id: number;
};

type TeamDirectory = {
  teams: TeamSpec[];
};

type Command = "check" | "apply" | "plan";

type PlanItem = {
  summary: string;
  details?: string[];
};

type TeamMembershipUpdate = {
  team: TeamSpec;
  missingMembers: string[];
};

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

type SyncPlan = {
  repoNameWithOwner: string;
  drift: string[];
  items: PlanItem[];
  missingTeamSlugs: string[];
  teamMembershipUpdates: TeamMembershipUpdate[];
};

const RULESET_DIR = resolve(process.cwd(), ".github", "rulesets");
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
  const plan = createSyncPlan(snapshot);

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

function createSyncPlan(snapshot: SyncSnapshot): SyncPlan {
  const drift: string[] = [];
  const items: PlanItem[] = [];

  for (const missingTeamSlug of snapshot.missingTeamSlugs) {
    drift.push(`Missing team: ${missingTeamSlug}`);
    items.push({ summary: `Create team ${missingTeamSlug}` });
  }

  for (const teamMembershipUpdate of snapshot.teamMembershipUpdates) {
    drift.push(
      `Team ${teamMembershipUpdate.team.slug} is missing members: ${teamMembershipUpdate.missingMembers.join(", ")}`
    );
    items.push({
      summary: `Add members to team ${teamMembershipUpdate.team.slug}: ${teamMembershipUpdate.missingMembers.join(", ")}`,
    });
  }

  const existingRulesetByName = new Map(
    snapshot.existingRulesets.map((ruleset) => [ruleset.name, ruleset] as const)
  );
  const teamSlugByIdForPlan = invertMap(
    createPlanningTeamIdBySlug(snapshot.teamIdBySlug, snapshot.missingTeamSlugs)
  );
  const integrationSlugById = invertMap(snapshot.integrationIdBySlug);

  for (const desiredRuleset of snapshot.desiredRulesetsForPlan) {
    const existingRuleset = existingRulesetByName.get(desiredRuleset.name);

    if (!existingRuleset) {
      drift.push(`Missing ruleset: ${desiredRuleset.name}`);
      items.push({ summary: `Create ruleset ${desiredRuleset.name}` });
      continue;
    }

    if (!rulesetsMatch(existingRuleset, desiredRuleset)) {
      drift.push(`Ruleset drift detected: ${desiredRuleset.name}`);
      items.push({
        summary: `Update ruleset ${desiredRuleset.name}`,
        details: describeRulesetDiff(
          existingRuleset,
          desiredRuleset,
          teamSlugByIdForPlan,
          integrationSlugById
        ),
      });
    }
  }

  for (const existingRuleset of snapshot.existingRulesets) {
    if (
      !snapshot.desiredRulesetsForPlan.some(
        (ruleset) => ruleset.name === existingRuleset.name
      )
    ) {
      drift.push(`Unmanaged remote ruleset present: ${existingRuleset.name}`);
      items.push({
        summary: `Remote-only ruleset present: ${existingRuleset.name} (manual cleanup)`,
      });
    }
  }

  return {
    repoNameWithOwner: snapshot.repo.nameWithOwner,
    drift,
    items,
    missingTeamSlugs: snapshot.missingTeamSlugs,
    teamMembershipUpdates: snapshot.teamMembershipUpdates,
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
  const files = [
    resolve(RULESET_DIR, "main.json"),
    resolve(RULESET_DIR, "cli-release-tags.json"),
  ];

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

function compileRuleset(
  spec: RulesetSpec,
  teamIdBySlug: Map<string, number>,
  integrationIdBySlug: Map<string, number>
): CompiledRulesetPayload {
  return {
    name: spec.name,
    target: spec.target,
    enforcement: spec.enforcement,
    conditions: {
      ref_name: {
        include: [...spec.conditions.ref_name.include],
        exclude: [...(spec.conditions.ref_name.exclude ?? [])],
      },
    },
    bypass_actors: spec.bypass_actors.map((actor) =>
      compileBypassActor(actor, teamIdBySlug, integrationIdBySlug)
    ),
    rules: spec.rules.map((rule) => compileRule(rule, integrationIdBySlug)),
  };
}

function createPlanningTeamIdBySlug(
  teamIdBySlug: Map<string, number>,
  missingTeamSlugs: string[]
): Map<string, number> {
  const planningMap = new Map(teamIdBySlug);
  let placeholderId = -1;

  for (const missingTeamSlug of missingTeamSlugs) {
    planningMap.set(missingTeamSlug, placeholderId);
    placeholderId -= 1;
  }

  return planningMap;
}

function invertMap(map: Map<string, number>): Map<number, string> {
  return new Map([...map.entries()].map(([key, value]) => [value, key]));
}

function compileBypassActor(
  actor: SpecBypassActor,
  teamIdBySlug: Map<string, number>,
  integrationIdBySlug: Map<string, number>
): CompiledBypassActor {
  if (actor.actor_type === "Team") {
    const actorId = teamIdBySlug.get(actor.actor_slug);
    if (!actorId) {
      throw new Error(`Unknown team slug in ruleset spec: ${actor.actor_slug}`);
    }

    return {
      actor_id: actorId,
      actor_type: "Team",
      bypass_mode: actor.bypass_mode ?? "always",
    };
  }

  const actorId = integrationIdBySlug.get(actor.actor_slug);
  if (!actorId) {
    throw new Error(
      `Unknown integration slug in ruleset spec: ${actor.actor_slug}`
    );
  }

  return {
    actor_id: actorId,
    actor_type: "Integration",
    bypass_mode: actor.bypass_mode ?? "always",
  };
}

function compileRule(
  rule: RuleSpec,
  integrationIdBySlug: Map<string, number>
): CompiledRule {
  switch (rule.type) {
    case "creation":
    case "deletion":
    case "non_fast_forward":
    case "required_linear_history":
      return rule;
    case "update":
      return rule;
    case "pull_request":
      return {
        type: "pull_request",
        parameters: {
          ...rule.parameters,
          allowed_merge_methods: [...rule.parameters.allowed_merge_methods],
        },
      };
    case "required_status_checks":
      return {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create:
            rule.parameters.do_not_enforce_on_create ?? false,
          strict_required_status_checks_policy:
            rule.parameters.strict_required_status_checks_policy,
          required_status_checks: rule.parameters.required_status_checks.map(
            (statusCheck) => {
              const integrationSlug = statusCheck.integration_slug;
              const integrationId = integrationSlug
                ? integrationIdBySlug.get(integrationSlug)
                : undefined;

              if (integrationSlug && !integrationId) {
                throw new Error(
                  `Unknown integration slug in status check rule: ${integrationSlug}`
                );
              }

              return {
                context: statusCheck.context,
                ...(integrationId ? { integration_id: integrationId } : {}),
              };
            }
          ),
        },
      };
  }
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

function rulesetsMatch(
  existingRuleset: ExistingRuleset,
  desiredRuleset: CompiledRulesetPayload
): boolean {
  return (
    stableStringify(normalizeRuleset(existingRuleset)) ===
    stableStringify(normalizeRuleset(desiredRuleset))
  );
}

function normalizeRuleset(
  ruleset: ExistingRuleset | CompiledRulesetPayload
): CompiledRulesetPayload {
  return {
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    conditions: {
      ref_name: {
        include: [...ruleset.conditions.ref_name.include].sort(),
        exclude: [...(ruleset.conditions.ref_name.exclude ?? [])].sort(),
      },
    },
    bypass_actors: [...ruleset.bypass_actors]
      .map((actor) => ({
        actor_id: actor.actor_id,
        actor_type: actor.actor_type,
        bypass_mode: actor.bypass_mode ?? "always",
      }))
      .sort(compareJson),
    rules: [...ruleset.rules].map(normalizeRule).sort(compareJson),
  };
}

function describeRulesetDiff(
  existingRuleset: ExistingRuleset,
  desiredRuleset: CompiledRulesetPayload,
  teamSlugById: Map<number, string>,
  integrationSlugById: Map<number, string>
): string[] {
  const before = describeRulesetForPlan(
    normalizeRuleset(existingRuleset),
    teamSlugById,
    integrationSlugById
  );
  const after = describeRulesetForPlan(
    normalizeRuleset(desiredRuleset),
    teamSlugById,
    integrationSlugById
  );

  return diffJson(before, after);
}

function describeRulesetForPlan(
  ruleset: CompiledRulesetPayload,
  teamSlugById: Map<number, string>,
  integrationSlugById: Map<number, string>
): unknown {
  return {
    name: ruleset.name,
    target: ruleset.target,
    enforcement: ruleset.enforcement,
    conditions: ruleset.conditions,
    bypass_actors: ruleset.bypass_actors.map((actor) =>
      actor.actor_type === "Team"
        ? `Team:${teamSlugById.get(actor.actor_id) ?? actor.actor_id}:${actor.bypass_mode}`
        : `Integration:${integrationSlugById.get(actor.actor_id) ?? actor.actor_id}:${actor.bypass_mode}`
    ),
    rules: ruleset.rules.map((rule) =>
      describeRuleForPlan(rule, integrationSlugById)
    ),
  };
}

function describeRuleForPlan(
  rule: CompiledRule,
  integrationSlugById: Map<number, string>
): unknown {
  switch (rule.type) {
    case "creation":
    case "deletion":
    case "non_fast_forward":
    case "required_linear_history":
      return rule;
    case "update":
      return rule;
    case "pull_request":
      return {
        type: rule.type,
        parameters: rule.parameters,
      };
    case "required_status_checks":
      return {
        type: rule.type,
        parameters: {
          ...rule.parameters,
          required_status_checks: rule.parameters.required_status_checks.map(
            (statusCheck) => ({
              context: statusCheck.context,
              integration:
                statusCheck.integration_id === undefined
                  ? null
                  : (integrationSlugById.get(statusCheck.integration_id) ??
                    statusCheck.integration_id),
            })
          ),
        },
      };
  }
}

function diffJson(before: unknown, after: unknown, prefix = ""): string[] {
  if (stableStringify(before) === stableStringify(after)) {
    return [];
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    return [
      `${prefix || "value"}: ${stableStringify(before)} -> ${stableStringify(after)}`,
    ];
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);

    return [...keys]
      .sort((left, right) => left.localeCompare(right))
      .flatMap((key) =>
        diffJson(before[key], after[key], prefix ? `${prefix}.${key}` : key)
      );
  }

  return [
    `${prefix || "value"}: ${stableStringify(before)} -> ${stableStringify(after)}`,
  ];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRule(
  rule: CompiledRule & {
    parameters?: {
      update_allows_fetch_and_merge?: boolean;
    };
  }
): CompiledRule {
  switch (rule.type) {
    case "creation":
    case "deletion":
    case "non_fast_forward":
    case "required_linear_history":
      return { type: rule.type };
    case "update":
      return {
        type: "update",
        parameters: {
          update_allows_fetch_and_merge:
            rule.parameters?.update_allows_fetch_and_merge ?? false,
        },
      };
    case "pull_request":
      return {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: [
            ...rule.parameters.allowed_merge_methods,
          ].sort(),
          dismiss_stale_reviews_on_push:
            rule.parameters.dismiss_stale_reviews_on_push,
          require_code_owner_review: rule.parameters.require_code_owner_review,
          require_last_push_approval:
            rule.parameters.require_last_push_approval,
          required_approving_review_count:
            rule.parameters.required_approving_review_count,
          required_review_thread_resolution:
            rule.parameters.required_review_thread_resolution,
        },
      };
    case "required_status_checks":
      return {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create:
            rule.parameters.do_not_enforce_on_create ?? false,
          strict_required_status_checks_policy:
            rule.parameters.strict_required_status_checks_policy,
          required_status_checks: [...rule.parameters.required_status_checks]
            .map((statusCheck) => ({
              context: statusCheck.context,
              ...(statusCheck.integration_id
                ? { integration_id: statusCheck.integration_id }
                : {}),
            }))
            .sort(compareJson),
        },
      };
  }
}

function compareJson(a: unknown, b: unknown): number {
  return stableStringify(a).localeCompare(stableStringify(b));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, sortValue(nestedValue)])
    );
  }

  return value;
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
