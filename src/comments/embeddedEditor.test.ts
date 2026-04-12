import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createEmbeddedEditor, type EmbeddedEditorHandle } from "./embeddedEditor";

describe("createEmbeddedEditor", () => {
  let container: HTMLElement;
  let handle: EmbeddedEditorHandle | null = null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    handle?.destroy();
    handle = null;
    container.remove();
    document.querySelectorAll(".yaos-extension-mention-dropdown").forEach((el) => el.remove());
  });

  it("creates an EditorView inside the container", () => {
    handle = createEmbeddedEditor(container, { placeholder: "Test..." });
    const cmEl = container.querySelector(".cm-editor");
    expect(cmEl).not.toBeNull();
  });

  it("returns a handle with getText that reads the document", () => {
    handle = createEmbeddedEditor(container, { placeholder: "Test..." });
    expect(handle.getText()).toBe("");
    handle.setText("hello");
    expect(handle.getText()).toBe("hello");
  });

  it("clears the document via clear()", () => {
    handle = createEmbeddedEditor(container, { placeholder: "Test..." });
    handle.setText("some text");
    handle.clear();
    expect(handle.getText()).toBe("");
  });

  it("focuses the editor via focus()", () => {
    handle = createEmbeddedEditor(container, { placeholder: "Test..." });
    handle.focus();
    expect(handle.view.hasFocus).toBe(true);
  });

  it("calls onSubmit when Enter is pressed without Shift", () => {
    const onSubmit = vi.fn();
    handle = createEmbeddedEditor(container, { placeholder: "Test...", onSubmit });
    handle.setText("comment");
    handle.view.focus();

    const keyboardEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: false,
      bubbles: true,
      cancelable: true,
    });
    handle.view.contentDOM.dispatchEvent(keyboardEvent);

    expect(onSubmit).toHaveBeenCalledWith("comment");
  });

  it("does not call onSubmit when Shift+Enter is pressed", () => {
    const onSubmit = vi.fn();
    handle = createEmbeddedEditor(container, { placeholder: "Test...", onSubmit });
    handle.setText("comment");

    const keyboardEvent = new KeyboardEvent("keydown", {
      key: "Enter",
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    handle.view.contentDOM.dispatchEvent(keyboardEvent);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("destroys the EditorView when destroy() is called", () => {
    handle = createEmbeddedEditor(container, { placeholder: "Test..." });
    const view = handle.view;
    handle.destroy();
    handle = null;
    expect(view.dom.parentNode).toBeNull();
  });
});
