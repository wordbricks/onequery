import { describe, expect, it } from "vitest";

import { createSyncPlan } from "./index";
import type {
  CompiledRulesetPayload,
  ExistingRuleset,
  SyncPlanInput,
  TeamSpec,
} from "./index";

const MAINTAINER_TEAM: TeamSpec = {
  slug: "onequery-maintainers",
  name: "OneQuery Maintainers",
  privacy: "closed",
  members: ["alice"],
};

describe("github ruleset planner", () => {
  it("treats logically equivalent rulesets as already synced", () => {
    const desiredRuleset = makeRuleset("Protect main");
    const existingRuleset = makeExistingRuleset("Protect main", {
      bypass_actors: [...desiredRuleset.bypass_actors].reverse(),
      conditions: {
        ref_name: {
          include: [...desiredRuleset.conditions.ref_name.include].reverse(),
          exclude: [...desiredRuleset.conditions.ref_name.exclude].reverse(),
        },
      },
      rules: [...desiredRuleset.rules].reverse(),
    });

    const plan = createSyncPlan(
      makePlanInput({
        existingRulesets: [existingRuleset],
        desiredRulesetsForPlan: [desiredRuleset],
      })
    );

    expect(plan.drift).toEqual([]);
    expect(plan.items).toEqual([]);
  });

  it("plans missing teams, memberships, and rulesets", () => {
    const plan = createSyncPlan(
      makePlanInput({
        missingTeamSlugs: ["release-engineering"],
        teamMembershipUpdates: [
          {
            team: MAINTAINER_TEAM,
            missingMembers: ["bob", "carol"],
          },
        ],
        desiredRulesetsForPlan: [makeRuleset("Protect main")],
      })
    );

    expect(plan.drift).toEqual([
      "Missing team: release-engineering",
      "Team onequery-maintainers is missing members: bob, carol",
      "Missing ruleset: Protect main",
    ]);
    expect(plan.items).toEqual([
      { summary: "Create team release-engineering" },
      { summary: "Add members to team onequery-maintainers: bob, carol" },
      { summary: "Create ruleset Protect main" },
    ]);
  });

  it("describes ruleset drift and remote-only rulesets", () => {
    const desiredRuleset = makeRuleset("Protect main", {
      bypass_actors: [
        {
          actor_id: 1,
          actor_type: "Team",
          bypass_mode: "pull_request",
        },
      ],
    });
    const existingRuleset = makeExistingRuleset("Protect main", {
      bypass_actors: [
        {
          actor_id: 1,
          actor_type: "Team",
          bypass_mode: "always",
        },
      ],
    });

    const plan = createSyncPlan(
      makePlanInput({
        existingRulesets: [
          existingRuleset,
          makeExistingRuleset("Protect CLI release tags"),
        ],
        desiredRulesetsForPlan: [desiredRuleset],
      })
    );

    expect(plan.drift).toEqual([
      "Ruleset drift detected: Protect main",
      "Unmanaged remote ruleset present: Protect CLI release tags",
    ]);
    expect(plan.items).toHaveLength(2);
    expect(plan.items[0]?.summary).toBe("Update ruleset Protect main");
    expect(plan.items[0]?.details).toContain(
      'bypass_actors: ["Team:onequery-maintainers:always"] -> ["Team:onequery-maintainers:pull_request"]'
    );
    expect(plan.items[1]).toEqual({
      summary:
        "Remote-only ruleset present: Protect CLI release tags (manual cleanup)",
    });
  });
});

function makePlanInput(overrides: Partial<SyncPlanInput> = {}): SyncPlanInput {
  return {
    repoNameWithOwner: "wordbricks/onequery",
    teamIdBySlug: new Map([["onequery-maintainers", 1]]),
    missingTeamSlugs: [],
    teamMembershipUpdates: [],
    integrationIdBySlug: new Map([["github-actions", 10]]),
    existingRulesets: [],
    desiredRulesetsForPlan: [],
    ...overrides,
  };
}

function makeRuleset(
  name: string,
  overrides: Partial<CompiledRulesetPayload> = {}
): CompiledRulesetPayload {
  return {
    name,
    target: "branch",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: ["refs/heads/main"],
        exclude: [],
      },
    },
    bypass_actors: [
      {
        actor_id: 1,
        actor_type: "Team",
        bypass_mode: "pull_request",
      },
      {
        actor_id: 10,
        actor_type: "Integration",
        bypass_mode: "always",
      },
    ],
    rules: [
      {
        type: "required_status_checks",
        parameters: {
          do_not_enforce_on_create: false,
          strict_required_status_checks_policy: true,
          required_status_checks: [
            {
              context: "CI results (required)",
              integration_id: 10,
            },
          ],
        },
      },
      {
        type: "pull_request",
        parameters: {
          allowed_merge_methods: ["squash"],
          dismiss_stale_reviews_on_push: true,
          require_code_owner_review: false,
          require_last_push_approval: false,
          required_approving_review_count: 0,
          required_review_thread_resolution: true,
        },
      },
      {
        type: "required_linear_history",
      },
    ],
    ...overrides,
  };
}

function makeExistingRuleset(
  name: string,
  overrides: Partial<ExistingRuleset> = {}
): ExistingRuleset {
  return {
    id: 1,
    ...makeRuleset(name, overrides),
    ...overrides,
  };
}
