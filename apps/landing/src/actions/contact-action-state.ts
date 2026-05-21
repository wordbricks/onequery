export type ContactActionState = {
  status: "idle" | "sent";
};

export const INITIAL_CONTACT_ACTION_STATE = {
  status: "idle",
} satisfies ContactActionState;

export const SENT_CONTACT_ACTION_STATE = {
  status: "sent",
} satisfies ContactActionState;
