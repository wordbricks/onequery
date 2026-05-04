import type { AuditListItem } from "@onequery/audit-contracts/audit";
import { assign, setup } from "xstate";

export const AUDIT_DETAIL_PANEL_EVENT = {
  CLOSE_DETAILS: "auditDetailPanel/closeDetails",
  ROW_SELECTED: "auditDetailPanel/rowSelected",
} as const;

const AUDIT_DETAIL_PANEL_STATE = {
  CLOSED: "closed",
  OPEN: "open",
} as const;

export const AUDIT_DETAIL_PANEL_TAG = {
  DETAILS_VISIBLE: "detailsVisible",
} as const;

type AuditDetailPanelContext = {
  selectedItem: AuditListItem;
};

type AuditDetailPanelEvent =
  | { type: typeof AUDIT_DETAIL_PANEL_EVENT.CLOSE_DETAILS }
  | {
      type: typeof AUDIT_DETAIL_PANEL_EVENT.ROW_SELECTED;
      item: AuditListItem;
    };

type AuditDetailPanelInput = {
  initialItem: AuditListItem;
};

type AuditDetailPanelTypes = {
  context: AuditDetailPanelContext;
  events: AuditDetailPanelEvent;
  input: AuditDetailPanelInput;
};

export const auditDetailPanelMachine = setup({
  actions: {
    selectItem: assign({
      selectedItem: (_, params: { item: AuditListItem }) => params.item,
    }),
  },
  guards: {
    isSelectedItem: ({ context }, params: { item: AuditListItem }) =>
      context.selectedItem.id === params.item.id,
  },
  types: {} as AuditDetailPanelTypes,
}).createMachine({
  context: ({ input }) => ({
    selectedItem: input.initialItem,
  }),
  id: "auditDetailPanel",
  initial: AUDIT_DETAIL_PANEL_STATE.CLOSED,
  states: {
    [AUDIT_DETAIL_PANEL_STATE.CLOSED]: {
      on: {
        [AUDIT_DETAIL_PANEL_EVENT.ROW_SELECTED]: {
          actions: {
            params: ({ event }) => ({
              item: event.item,
            }),
            type: "selectItem",
          },
          target: AUDIT_DETAIL_PANEL_STATE.OPEN,
        },
      },
    },
    [AUDIT_DETAIL_PANEL_STATE.OPEN]: {
      on: {
        [AUDIT_DETAIL_PANEL_EVENT.CLOSE_DETAILS]: {
          target: AUDIT_DETAIL_PANEL_STATE.CLOSED,
        },
        [AUDIT_DETAIL_PANEL_EVENT.ROW_SELECTED]: [
          {
            guard: {
              params: ({ event }) => ({
                item: event.item,
              }),
              type: "isSelectedItem",
            },
            target: AUDIT_DETAIL_PANEL_STATE.CLOSED,
          },
          {
            actions: {
              params: ({ event }) => ({
                item: event.item,
              }),
              type: "selectItem",
            },
            target: AUDIT_DETAIL_PANEL_STATE.OPEN,
          },
        ],
      },
      tags: AUDIT_DETAIL_PANEL_TAG.DETAILS_VISIBLE,
    },
  },
});
