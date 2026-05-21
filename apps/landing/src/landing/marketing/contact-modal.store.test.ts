import { describe, expect, it } from "vitest";

import {
  createContactModalStore,
  isContactModalOpen,
} from "./contact-modal.store";

describe("createContactModalStore", () => {
  it("opens and closes the modal", () => {
    const contactModalStore = createContactModalStore();

    expect(isContactModalOpen(contactModalStore.$contactModalState.get())).toBe(
      false
    );

    contactModalStore.open();

    expect(isContactModalOpen(contactModalStore.$contactModalState.get())).toBe(
      true
    );

    contactModalStore.close();

    expect(isContactModalOpen(contactModalStore.$contactModalState.get())).toBe(
      false
    );
  });

  it("tracks the first open request until the modal closes", () => {
    let openRequestCount = 0;
    const contactModalStore = createContactModalStore({
      trackOpenRequested: () => {
        openRequestCount += 1;
      },
    });

    contactModalStore.open();
    contactModalStore.open();

    expect(openRequestCount).toBe(1);

    contactModalStore.close();
    contactModalStore.open();

    expect(openRequestCount).toBe(2);
  });
});
