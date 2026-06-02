import {
  trackContactFormSubmitted,
  trackContactModalOpened,
} from "@/shared/analytics/events";

export type ContactSubmissionResult =
  | {
      ok: true;
    }
  | {
      message: string;
      ok: false;
    };

type FooterContactModalOptions = {
  submit: (formData: FormData) => Promise<ContactSubmissionResult>;
};

type ContactElements = {
  backdrop: HTMLElement;
  closeButton: HTMLButtonElement;
  errorMessage: HTMLElement;
  fields: Array<HTMLInputElement | HTMLTextAreaElement>;
  form: HTMLFormElement;
  modal: HTMLElement;
  openButton: HTMLButtonElement;
  submitButton: HTMLButtonElement | null;
};

function readRootCssTimeMs(name: string, fallback: number) {
  const rawValue = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  const value = parseFloat(rawValue);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return rawValue.endsWith("ms") ? value : value * 1000;
}

function readContactElements(): ContactElements | null {
  const openButton = document.querySelector("[data-contact-open]");
  const backdrop = document.querySelector("[data-contact-backdrop]");
  const modal = document.querySelector("[data-contact-modal]");
  const form = document.querySelector("[data-contact-form]");
  const closeButton = document.querySelector("[data-contact-close]");
  const errorMessage = document.querySelector("[data-contact-error]");

  if (
    !(openButton instanceof HTMLButtonElement) ||
    !(backdrop instanceof HTMLElement) ||
    !(modal instanceof HTMLElement) ||
    !(form instanceof HTMLFormElement) ||
    !(closeButton instanceof HTMLButtonElement) ||
    !(errorMessage instanceof HTMLElement)
  ) {
    return null;
  }

  return {
    backdrop,
    closeButton,
    errorMessage,
    fields: Array.from(
      form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(".t-input")
    ),
    form,
    modal,
    openButton,
    submitButton: form.querySelector<HTMLButtonElement>(
      ".contact-modal-submit"
    ),
  };
}

export function installFooterContactModal({
  submit,
}: FooterContactModalOptions) {
  const elements = readContactElements();

  if (!elements) {
    return;
  }

  const {
    backdrop,
    closeButton,
    errorMessage,
    fields,
    form,
    modal,
    openButton,
    submitButton,
  } = elements;
  let closeTimer = 0;
  let focusedBeforeOpen: Element | null = null;
  let previousBodyOverflow = "";
  let shakeTimer = 0;
  let revertTimer = 0;
  let pendingSubmissionController: AbortController | null = null;
  let submissionId = 0;

  function clearError() {
    window.clearTimeout(shakeTimer);
    window.clearTimeout(revertTimer);
    shakeTimer = 0;
    revertTimer = 0;
    form.classList.remove("is-error");

    for (const field of fields) {
      field.classList.remove("is-error", "is-shaking");
    }
  }

  function showError(message: string) {
    clearError();
    errorMessage.textContent = message;
    form.classList.add("is-error");

    for (const field of fields) {
      field.classList.add("is-error");
      field.classList.remove("is-shaking");
    }

    void form.offsetWidth;

    for (const field of fields) {
      field.classList.add("is-shaking");
    }

    const shakeMs =
      readRootCssTimeMs("--shake-dur-a", 80) * 2 +
      readRootCssTimeMs("--shake-dur-b", 60) * 2;

    shakeTimer = window.setTimeout(() => {
      for (const field of fields) {
        field.classList.remove("is-shaking");
      }
      shakeTimer = 0;
    }, shakeMs + 20);

    revertTimer = window.setTimeout(
      clearError,
      shakeMs + readRootCssTimeMs("--revert-hold", 3000)
    );
  }

  function setPending(isPending: boolean) {
    for (const field of fields) {
      field.disabled = isPending;
    }

    if (submitButton) {
      submitButton.disabled = isPending;
      submitButton.textContent = isPending ? "Sending..." : "Send message";
    }
  }

  function isCurrentSubmission(
    controller: AbortController,
    currentSubmissionId: number
  ) {
    return (
      pendingSubmissionController === controller &&
      submissionId === currentSubmissionId
    );
  }

  function cancelPendingSubmission() {
    if (pendingSubmissionController) {
      pendingSubmissionController.abort();
      pendingSubmissionController = null;
    }

    submissionId += 1;
    setPending(false);
  }

  function closeModal() {
    window.clearTimeout(closeTimer);
    cancelPendingSubmission();
    clearError();
    backdrop.classList.remove("is-open");
    backdrop.classList.add("is-closing");
    modal.classList.remove("is-open");
    modal.classList.add("is-closing");
    openButton.setAttribute("aria-expanded", "false");

    closeTimer = window.setTimeout(
      () => {
        backdrop.hidden = true;
        backdrop.classList.remove("is-closing");
        modal.classList.remove("is-closing");
        document.body.style.overflow = previousBodyOverflow;
        clearError();

        if (focusedBeforeOpen instanceof HTMLElement) {
          focusedBeforeOpen.focus();
        }
      },
      readRootCssTimeMs("--modal-close-dur", 150)
    );
  }

  function openModal() {
    window.clearTimeout(closeTimer);
    clearError();
    focusedBeforeOpen = document.activeElement;
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    backdrop.hidden = false;
    backdrop.classList.remove("is-closing");
    modal.classList.remove("is-closing");
    openButton.setAttribute("aria-expanded", "true");
    trackContactModalOpened();

    window.requestAnimationFrame(() => {
      backdrop.classList.add("is-open");
      modal.classList.add("is-open");
      const nameField = form.elements.namedItem("name");
      if (nameField instanceof HTMLElement) {
        nameField.focus();
      }
    });
  }

  async function submitContactForm(event: SubmitEvent) {
    event.preventDefault();

    if (pendingSubmissionController) {
      return;
    }

    if (!form.reportValidity()) {
      showError("Please fill out the required fields");
      return;
    }

    const formData = new FormData(form);
    const controller = new AbortController();
    const currentSubmissionId = submissionId + 1;

    pendingSubmissionController = controller;
    submissionId = currentSubmissionId;
    clearError();
    setPending(true);

    try {
      const result = await submit(formData);

      if (!isCurrentSubmission(controller, currentSubmissionId)) {
        return;
      }

      if (!result.ok) {
        showError(result.message);
        return;
      }

      trackContactFormSubmitted();
      form.reset();
      closeModal();
    } catch {
      if (
        !isCurrentSubmission(controller, currentSubmissionId) ||
        controller.signal.aborted
      ) {
        return;
      }

      showError("Failed to send message");
    } finally {
      if (isCurrentSubmission(controller, currentSubmissionId)) {
        pendingSubmissionController = null;
        setPending(false);
      }
    }
  }

  openButton.addEventListener("click", openModal);
  closeButton.addEventListener("click", closeModal);
  backdrop.addEventListener("mousedown", closeModal);
  modal.addEventListener("mousedown", (event) => {
    event.stopPropagation();
  });
  form.addEventListener("submit", submitContactForm);
  form.addEventListener("input", clearError);
  form.addEventListener(
    "invalid",
    () => {
      showError("Please fill out the required fields");
    },
    true
  );
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !backdrop.hidden) {
      closeModal();
    }
  });
}
