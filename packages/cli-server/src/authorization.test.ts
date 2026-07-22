import { describe, expect, it } from "vitest";

import {
  CLI_ACTIONS,
  canCliActorAccessAction,
  resolveCliActorAuthorization,
} from "./authorization";

const FULL_CAPABILITIES = [
  "org.list",
  "org.read",
  "source.connect",
  "source.list",
  "source.read",
  "source.write",
  "source_api.describe",
  "source_api.execute",
  "query.execute",
];

describe("cli authorization", () => {
  it("defines an explicit action surface", () => {
    expect(CLI_ACTIONS).toEqual([
      "org.list",
      "org.read",
      "source.connect",
      "source.list",
      "source.read",
      "source.write",
      "source_api.describe",
      "source_api.execute",
      "query.execute",
    ]);
  });

  it.each(["admin", "member", "owner"] as const)(
    "maps %s role to the full standard CLI capability set",
    (rawMembershipRole) => {
      expect(
        resolveCliActorAuthorization({
          action: "query.execute",
          rawMembershipRole,
        })
      ).toEqual({
        capabilities: FULL_CAPABILITIES,
        isKnownAction: true,
        membershipRoles: [rawMembershipRole],
      });
    }
  );

  it("allows known actions through the boolean helper", () => {
    expect(
      canCliActorAccessAction({
        action: "query.execute",
        rawMembershipRole: "member",
      })
    ).toBe(true);
  });

  it("unions multiple Better Auth membership roles instead of collapsing them", () => {
    expect(
      resolveCliActorAuthorization({
        action: "query.execute",
        rawMembershipRole: "member, admin",
      })
    ).toEqual({
      capabilities: FULL_CAPABILITIES,
      isKnownAction: true,
      membershipRoles: ["member", "admin"],
    });
  });

  it("ignores duplicate and unknown roles while preserving known ones", () => {
    expect(
      resolveCliActorAuthorization({
        action: "source.read",
        rawMembershipRole: "member, member, billing-admin",
      })
    ).toEqual({
      capabilities: FULL_CAPABILITIES,
      isKnownAction: true,
      membershipRoles: ["member"],
    });
  });

  it("denies unknown roles by default", () => {
    expect(
      resolveCliActorAuthorization({
        action: "source.read",
        rawMembershipRole: "billing-admin",
      })
    ).toEqual({
      capabilities: [],
      isKnownAction: true,
      membershipRoles: [],
    });
  });

  it("denies unknown actions by default", () => {
    expect(
      canCliActorAccessAction({
        action: "org.delete",
        rawMembershipRole: "owner",
      })
    ).toBe(false);
  });
});
