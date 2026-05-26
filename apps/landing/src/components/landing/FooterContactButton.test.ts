import { readFileSync } from "node:fs";
import vm from "node:vm";

import { describe, expect, it, vi } from "vitest";

type Listener = (event: Record<string, unknown>) => unknown;

class FakeClassList {
  private readonly classNames = new Set<string>();

  add(...classNames: string[]) {
    for (const className of classNames) {
      this.classNames.add(className);
    }
  }

  contains(className: string) {
    return this.classNames.has(className);
  }

  remove(...classNames: string[]) {
    for (const className of classNames) {
      this.classNames.delete(className);
    }
  }
}

class FakeHTMLElement {
  readonly attributes = new Map<string, string>();
  readonly classList = new FakeClassList();
  disabled = false;
  hidden = false;
  readonly listeners = new Map<string, Listener[]>();
  readonly style: Record<string, string> = {};
  textContent = "";

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type: string, event: Record<string, unknown> = {}) {
    return Promise.all(
      (this.listeners.get(type) ?? []).map((listener) => listener(event))
    );
  }

  focus() {
    fakeDocument.activeElement = this;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

class FakeHTMLButtonElement extends FakeHTMLElement {}

class FakeHTMLFormElement extends FakeHTMLElement {
  action = "https://onequery.test/api/contact/";
  readonly elements = {
    namedItem: (name: string) =>
      name === "name" ? fakeElements.nameField : null,
  };
  readonly reportValidity = vi.fn(() => true);
  readonly reset = vi.fn();

  querySelector(selector: string) {
    return selector === ".contact-modal-submit"
      ? fakeElements.submitButton
      : null;
  }

  querySelectorAll(selector: string) {
    return selector === ".t-input" ? fakeElements.fields : [];
  }
}

const fakeElements = {
  backdrop: new FakeHTMLElement(),
  closeButton: new FakeHTMLButtonElement(),
  errorMessage: new FakeHTMLElement(),
  fields: [] as FakeHTMLElement[],
  form: new FakeHTMLFormElement(),
  modal: new FakeHTMLElement(),
  nameField: new FakeHTMLElement(),
  openButton: new FakeHTMLButtonElement(),
  submitButton: new FakeHTMLButtonElement(),
};

const fakeDocument = {
  activeElement: null as FakeHTMLElement | null,
  body: {
    style: {} as Record<string, string>,
  },
  documentElement: new FakeHTMLElement(),
  querySelector(selector: string) {
    switch (selector) {
      case "[data-contact-open]":
        return fakeElements.openButton;
      case "[data-contact-backdrop]":
        return fakeElements.backdrop;
      case "[data-contact-modal]":
        return fakeElements.modal;
      case "[data-contact-form]":
        return fakeElements.form;
      case "[data-contact-close]":
        return fakeElements.closeButton;
      case "[data-contact-error]":
        return fakeElements.errorMessage;
      default:
        return null;
    }
  },
};

function readInlineScript() {
  const source = readFileSync(
    new URL("./FooterContactButton.astro", import.meta.url),
    "utf8"
  );
  const script = /<script is:inline>\s*([\s\S]*?)<\/script>/.exec(source);

  if (!script?.[1]) {
    throw new Error("FooterContactButton.astro inline script was not found");
  }

  return script[1];
}

function createEnvironment() {
  const formDataSnapshots: boolean[][] = [];
  const nameField = new FakeHTMLElement();
  const fields = [nameField, new FakeHTMLElement(), new FakeHTMLElement()];
  let resolveFetch:
    | ((response: { json: () => Promise<unknown>; ok: boolean }) => void)
    | undefined;

  fakeElements.backdrop = new FakeHTMLElement();
  fakeElements.closeButton = new FakeHTMLButtonElement();
  fakeElements.errorMessage = new FakeHTMLElement();
  fakeElements.fields = fields;
  fakeElements.form = new FakeHTMLFormElement();
  fakeElements.modal = new FakeHTMLElement();
  fakeElements.nameField = nameField;
  fakeElements.openButton = new FakeHTMLButtonElement();
  fakeElements.submitButton = new FakeHTMLButtonElement();
  fakeElements.submitButton.textContent = "Send message";
  fakeDocument.activeElement = null;
  fakeDocument.body.style = {};

  const fetch = vi.fn(
    (_action: string, _init: RequestInit) =>
      new Promise<{ json: () => Promise<unknown>; ok: boolean }>((resolve) => {
        resolveFetch = resolve;
      })
  );

  function FakeFormData(_form: FakeHTMLFormElement) {
    formDataSnapshots.push(fields.map((field) => field.disabled));
  }

  vm.runInNewContext(readInlineScript(), {
    AbortController,
    Array,
    DOMException,
    FormData: FakeFormData,
    HTMLButtonElement: FakeHTMLButtonElement,
    HTMLElement: FakeHTMLElement,
    HTMLFormElement: FakeHTMLFormElement,
    Object,
    document: fakeDocument,
    fetch,
    getComputedStyle: () => ({
      getPropertyValue: () => "",
    }),
    window: {
      addEventListener: vi.fn(),
      clearTimeout: vi.fn(),
      dataLayer: [],
      requestAnimationFrame: (callback: () => void) => {
        callback();
      },
      setTimeout: vi.fn(() => 1),
    },
  });

  return {
    fetch,
    fields,
    formDataSnapshots,
    resolveFetch: (response: { json: () => Promise<unknown>; ok: boolean }) => {
      if (!resolveFetch) {
        throw new Error("fetch was not called");
      }

      resolveFetch(response);
    },
  };
}

describe("FooterContactButton", () => {
  it("builds form data before disabling fields", async () => {
    const { formDataSnapshots, resolveFetch } = createEnvironment();
    const submit = fakeElements.form.dispatch("submit", {
      preventDefault: vi.fn(),
    });

    expect(formDataSnapshots).toEqual([[false, false, false]]);
    expect(fakeElements.fields.every((field) => field.disabled)).toBe(true);
    expect(fakeElements.submitButton.textContent).toBe("Sending...");

    resolveFetch({
      json: async () => ({}),
      ok: true,
    });
    await submit;

    expect(fakeElements.form.reset).toHaveBeenCalledOnce();
    expect(fakeElements.submitButton.disabled).toBe(false);
    expect(fakeElements.submitButton.textContent).toBe("Send message");
  });

  it("aborts and ignores a stale submission when the modal closes", async () => {
    const { fetch, resolveFetch } = createEnvironment();
    const submit = fakeElements.form.dispatch("submit", {
      preventDefault: vi.fn(),
    });

    await fakeElements.closeButton.dispatch("click");

    const signal = fetch.mock.calls[0]?.[1]?.signal;
    expect(signal?.aborted).toBe(true);
    expect(fakeElements.fields.every((field) => field.disabled)).toBe(false);
    expect(fakeElements.submitButton.disabled).toBe(false);
    expect(fakeElements.submitButton.textContent).toBe("Send message");

    resolveFetch({
      json: async () => ({
        message: "stale failure",
      }),
      ok: false,
    });
    await submit;

    expect(fakeElements.form.classList.contains("is-error")).toBe(false);
    expect(fakeElements.errorMessage.textContent).not.toBe("stale failure");
  });
});
