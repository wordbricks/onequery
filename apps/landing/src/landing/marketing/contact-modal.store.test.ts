import { describe, expect, it } from "vitest";

import {
  createContactModalStore,
  isContactModalOpen,
  isContactModalSubmitting,
  readContactModalErrorMessage,
} from "./contact-modal.store";

const CONTACT_FORM = {
  email: "jane@onequery.dev",
  message: "Need a rollout plan.",
  name: "Jane Doe",
} as const;
const FAILURE_MESSAGE = "Lead capture offline";

function fillContactForm(
  contactModalStore: ReturnType<typeof createContactModalStore>
) {
  contactModalStore.setField("name", CONTACT_FORM.name);
  contactModalStore.setField("email", CONTACT_FORM.email);
  contactModalStore.setField("message", CONTACT_FORM.message);
}

describe("createContactModalStore", () => {
  it("closes on success and resets the captured form state", async () => {
    const contactModalStore = createContactModalStore();

    contactModalStore.open();
    fillContactForm(contactModalStore);
    await contactModalStore.submit();

    const closed = contactModalStore.$contactModalState.get();

    expect(isContactModalOpen(closed)).toBe(false);
    expect(closed.form).toEqual({
      email: "",
      message: "",
      name: "",
    });
    expect(closed.submission).toEqual({
      kind: "idle",
    });
  });

  it("returns to editing with the previous form contents after a failed submit", async () => {
    const contactModalStore = createContactModalStore({
      submitContact: async () => {
        throw new Error(FAILURE_MESSAGE);
      },
    });

    contactModalStore.open();
    fillContactForm(contactModalStore);
    await contactModalStore.submit();

    const editing = contactModalStore.$contactModalState.get();

    expect(isContactModalOpen(editing)).toBe(true);
    expect(isContactModalSubmitting(editing)).toBe(false);
    expect(editing.form).toEqual(CONTACT_FORM);
    expect(readContactModalErrorMessage(editing)).toBe(FAILURE_MESSAGE);
  });

  it("aborts the active submit request when the modal closes", async () => {
    let abortCount = 0;
    let resolveSubmitStarted!: () => void;
    const submitStarted = new Promise<void>((resolve) => {
      resolveSubmitStarted = resolve;
    });
    const contactModalStore = createContactModalStore({
      submitContact: async ({ signal }) => {
        signal.addEventListener(
          "abort",
          () => {
            abortCount += 1;
          },
          { once: true }
        );
        resolveSubmitStarted();

        await new Promise(() => {});
      },
    });

    contactModalStore.open();
    fillContactForm(contactModalStore);
    void contactModalStore.submit();

    await submitStarted;

    expect(
      isContactModalSubmitting(contactModalStore.$contactModalState.get())
    ).toBe(true);

    contactModalStore.close();

    const closed = contactModalStore.$contactModalState.get();

    expect(abortCount).toBe(1);
    expect(isContactModalOpen(closed)).toBe(false);
    expect(closed.form).toEqual({
      email: "",
      message: "",
      name: "",
    });
  });
});
