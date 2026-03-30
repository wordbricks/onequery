export type BypassMode = "always" | "pull_request";
export type RulesetTarget = "branch" | "tag";
export type RulesetEnforcement = "active" | "disabled" | "evaluate";
export type TeamPrivacy = "closed" | "secret";

export type TeamSpec = {
  slug: string;
  name: string;
  privacy: TeamPrivacy;
  members: string[];
};

export type IntegrationActorSpec = {
  actor_type: "Integration";
  actor_slug: "github-actions";
  bypass_mode?: BypassMode;
};

export type TeamActorSpec = {
  actor_type: "Team";
  actor_slug: string;
  bypass_mode?: BypassMode;
};

export type SpecBypassActor = IntegrationActorSpec | TeamActorSpec;

export type RequiredStatusCheckSpec = {
  context: string;
  integration_slug?: "github-actions";
};

export type RuleSpec =
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

export type RulesetSpec = {
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

export type CompiledBypassActor = {
  actor_id: number;
  actor_type: "Integration" | "Team";
  bypass_mode: BypassMode;
};

export type CompiledRequiredStatusCheck = {
  context: string;
  integration_id?: number;
};

export type CompiledRule =
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

export type CompiledRulesetPayload = {
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

export type ExistingRuleset = CompiledRulesetPayload & {
  id: number;
};

export type PlanItem = {
  summary: string;
  details?: string[];
};

export type TeamMembershipUpdate = {
  team: TeamSpec;
  missingMembers: string[];
};

export type SyncPlanInput = {
  repoNameWithOwner: string;
  teamIdBySlug: Map<string, number>;
  missingTeamSlugs: string[];
  teamMembershipUpdates: TeamMembershipUpdate[];
  integrationIdBySlug: Map<string, number>;
  existingRulesets: ExistingRuleset[];
  desiredRulesetsForPlan: CompiledRulesetPayload[];
};

export type SyncPlan = {
  repoNameWithOwner: string;
  drift: string[];
  items: PlanItem[];
  missingTeamSlugs: string[];
  teamMembershipUpdates: TeamMembershipUpdate[];
};

export function createPlanningTeamIdBySlug(
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

export function invertMap(map: Map<string, number>): Map<number, string> {
  return new Map([...map.entries()].map(([key, value]) => [value, key]));
}

export function compileRuleset(
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

export function createSyncPlan(snapshot: SyncPlanInput): SyncPlan {
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
    repoNameWithOwner: snapshot.repoNameWithOwner,
    drift,
    items,
    missingTeamSlugs: snapshot.missingTeamSlugs,
    teamMembershipUpdates: snapshot.teamMembershipUpdates,
  };
}

export function rulesetsMatch(
  existingRuleset: ExistingRuleset,
  desiredRuleset: CompiledRulesetPayload
): boolean {
  return (
    stableStringify(normalizeRuleset(existingRuleset)) ===
    stableStringify(normalizeRuleset(desiredRuleset))
  );
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
