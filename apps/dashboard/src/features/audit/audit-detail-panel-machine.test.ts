import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import {
  AUDIT_DETAIL_PANEL_EVENT,
  AUDIT_DETAIL_PANEL_TAG,
  auditDetailPanelMachine,
} from "./audit-detail-panel-machine";
import { createAuditListItem } from "./audit-test-fixtures";

describe("auditDetailPanelMachine", () => {
  it("opens, switches, and closes details around row selection", () => {
    const firstItem = createAuditListItem({
      familyActionId: "query-action-1",
      id: "audit-1",
    });
    const secondItem = createAuditListItem({
      familyActionId: "query-action-2",
      id: "audit-2",
    });
    const actor = createActor(auditDetailPanelMachine, {
      input: {
        initialItem: firstItem,
      },
    });

    actor.start();

    expect(actor.getSnapshot().matches("closed")).toBe(true);
    expect(actor.getSnapshot().context.selectedItem.id).toBe("audit-1");
    expect(
      actor.getSnapshot().hasTag(AUDIT_DETAIL_PANEL_TAG.DETAILS_VISIBLE)
    ).toBe(false);

    actor.send({
      item: firstItem,
      type: AUDIT_DETAIL_PANEL_EVENT.ROW_SELECTED,
    });

    expect(actor.getSnapshot().matches("open")).toBe(true);
    expect(actor.getSnapshot().context.selectedItem.id).toBe("audit-1");
    expect(
      actor.getSnapshot().hasTag(AUDIT_DETAIL_PANEL_TAG.DETAILS_VISIBLE)
    ).toBe(true);

    actor.send({
      item: secondItem,
      type: AUDIT_DETAIL_PANEL_EVENT.ROW_SELECTED,
    });

    expect(actor.getSnapshot().matches("open")).toBe(true);
    expect(actor.getSnapshot().context.selectedItem.id).toBe("audit-2");

    actor.send({
      item: secondItem,
      type: AUDIT_DETAIL_PANEL_EVENT.ROW_SELECTED,
    });

    expect(actor.getSnapshot().matches("closed")).toBe(true);
    expect(actor.getSnapshot().context.selectedItem.id).toBe("audit-2");
  });
});
