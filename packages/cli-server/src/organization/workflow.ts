import type {
  CliOrgAccessDecision,
  CliOrgAccessResult,
} from "../domain/workflows";

export function finishCliOrgAccessWorkflow(input: {
  orgSlug: string;
  access: CliOrgAccessResult;
}): CliOrgAccessDecision {
  switch (input.access.kind) {
    case "found": {
      return {
        kind: "allowed",
        org: input.access.org,
        rawMembershipRole: input.access.rawMembershipRole,
      };
    }
    case "not_found": {
      return {
        kind: "org_not_found",
        orgSlug: input.orgSlug,
      };
    }
    case "forbidden": {
      return {
        kind: "forbidden",
        orgSlug: input.orgSlug,
      };
    }
  }
}
