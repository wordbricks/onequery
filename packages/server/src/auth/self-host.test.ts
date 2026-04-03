import { schema } from "@onequery/db/server";
import { describe, expect, it, vi } from "vitest";

import {
  INVITE_ONLY_SIGNUP_MESSAGE,
  authorizeSelfHostSignUp,
} from "./self-host";

describe("self-host auth guards", () => {
  it("rejects invalid signup lookup emails before invitation queries", async () => {
    const userFindFirst = vi.fn().mockResolvedValue({ id: "user_1" });
    const invitationFindMany = vi.fn();
    const db = {
      query: {
        invitation: {
          findMany: invitationFindMany,
        },
        user: {
          findFirst: userFindFirst,
        },
      },
    } as never;

    const result = await authorizeSelfHostSignUp({
      db,
      email: "   ",
      schema,
    });

    expect(result).toMatchObject({
      allowed: false,
      message: INVITE_ONLY_SIGNUP_MESSAGE,
      state: {
        hasUsers: true,
        signupMode: "invite-only",
      },
    });
    expect(userFindFirst).toHaveBeenCalledTimes(1);
    expect(invitationFindMany).not.toHaveBeenCalled();
  });
});
