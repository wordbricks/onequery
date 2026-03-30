import { describe, expect, it } from "vitest";

import {
  CLI_ACTIONS,
  canCliActorAccessAction,
  resolveCliActorAuthorization,
} from "./authorization";

describe("cli authorization", () => {
  it("defines an explicit action surface", () => {
    expect(CLI_ACTIONS).toEqual([
      "org.list",
      "org.read",
      "source.connect",
      "source.list",
      "source.read",
      "query.execute",
    ]);
  });

  it("covers the full role-to-action matrix exhaustively", () => {
    expect({
      admin: CLI_ACTIONS.map((action) => [
        action,
        canCliActorAccessAction({
          action,
          rawMembershipRole: "admin",
        }),
      ]),
      member: CLI_ACTIONS.map((action) => [
        action,
        canCliActorAccessAction({
          action,
          rawMembershipRole: "member",
        }),
      ]),
      owner: CLI_ACTIONS.map((action) => [
        action,
        canCliActorAccessAction({
          action,
          rawMembershipRole: "owner",
        }),
      ]),
    }).toEqual({
      admin: [
        ["org.list", true],
        ["org.read", true],
        ["source.connect", true],
        ["source.list", true],
        ["source.read", true],
        ["query.execute", true],
      ],
      member: [
        ["org.list", true],
        ["org.read", true],
        ["source.connect", true],
        ["source.list", true],
        ["source.read", true],
        ["query.execute", true],
      ],
      owner: [
        ["org.list", true],
        ["org.read", true],
        ["source.connect", true],
        ["source.list", true],
        ["source.read", true],
        ["query.execute", true],
      ],
    });
  });

  it("maps member role to the full standard CLI capability set", () => {
    expect(
      resolveCliActorAuthorization({
        action: "query.execute",
        rawMembershipRole: "member",
      })
    ).toEqual({
      capabilities: [
        "org.list",
        "org.read",
        "source.connect",
        "source.list",
        "source.read",
        "query.execute",
      ],
      isKnownAction: true,
      membershipRoles: ["member"],
    });
  });

  it("maps admin role to the full standard CLI capability set", () => {
    expect(
      resolveCliActorAuthorization({
        action: "query.execute",
        rawMembershipRole: "admin",
      })
    ).toEqual({
      capabilities: [
        "org.list",
        "org.read",
        "source.connect",
        "source.list",
        "source.read",
        "query.execute",
      ],
      isKnownAction: true,
      membershipRoles: ["admin"],
    });
  });

  it("maps owner role to the full standard CLI org capability set", () => {
    expect(
      resolveCliActorAuthorization({
        action: "query.execute",
        rawMembershipRole: "owner",
      })
    ).toEqual({
      capabilities: [
        "org.list",
        "org.read",
        "source.connect",
        "source.list",
        "source.read",
        "query.execute",
      ],
      isKnownAction: true,
      membershipRoles: ["owner"],
    });
  });

  it("unions multiple Better Auth membership roles instead of collapsing them", () => {
    expect(
      resolveCliActorAuthorization({
        action: "query.execute",
        rawMembershipRole: "member, admin",
      })
    ).toEqual({
      capabilities: [
        "org.list",
        "org.read",
        "source.connect",
        "source.list",
        "source.read",
        "query.execute",
      ],
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
      capabilities: [
        "org.list",
        "org.read",
        "source.connect",
        "source.list",
        "source.read",
        "query.execute",
      ],
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
