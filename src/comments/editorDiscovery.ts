import { App } from "obsidian";

type EditorComponentConstructor = new (app: App, containerEl: HTMLElement, owner: any) => any;

let cachedAZClass: EditorComponentConstructor | null = null;
let discoveryAttempted = false;

const REQUIRED_PROPS = [
  "buildLocalExtensions",
  "getDynamicExtensions",
  "show",
  "hide",
  "focus",
  "set",
  "clear",
  "destroy",
  "onload",
];

function isAZClass(cls: any): cls is EditorComponentConstructor {
  if (typeof cls !== "function") return false;
  // The target class (aZ) takes 3 params: (app, containerEl, owner).
  // The editMode class (j6) takes 1 param: (markdownView) and inherits
  // all required methods from aZ via the prototype chain, so we must
  // filter it out by constructor arity.
  if (cls.length < 2) return false;
  const proto = cls.prototype;
  if (!proto) return false;
  return REQUIRED_PROPS.every((prop) => typeof proto[prop] === "function");
}

function discoverFromEditMode(editMode: any): EditorComponentConstructor | null {
  if (!editMode) return null;

  const level1 = Object.getPrototypeOf(editMode);
  if (!level1) return null;

  const level1Ctor = level1.constructor;
  if (isAZClass(level1Ctor)) return level1Ctor;

  const level2 = Object.getPrototypeOf(level1);
  if (!level2) return null;

  const level2Ctor = level2.constructor;
  if (isAZClass(level2Ctor)) return level2Ctor;

  return null;
}

function tryDiscover(app: App): EditorComponentConstructor | null {
  const mdLeaves = app.workspace.getLeavesOfType("markdown");
  for (const leaf of mdLeaves) {
    const view = (leaf as any).view;
    if (view?.editMode) {
      const cls = discoverFromEditMode(view.editMode);
      if (cls) return cls;
    }
  }
  return null;
}

export function getEditorComponentClass(app: App): EditorComponentConstructor | null {
  if (cachedAZClass) return cachedAZClass;

  const cls = tryDiscover(app);
  if (cls) {
    cachedAZClass = cls;
    discoveryAttempted = true;
    return cls;
  }

  if (!discoveryAttempted) {
    discoveryAttempted = true;
  }

  return null;
}

export function resetEditorDiscovery(): void {
  cachedAZClass = null;
  discoveryAttempted = false;
}