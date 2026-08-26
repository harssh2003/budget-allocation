/**
 * Minimal DOM implementation, sufficient to execute the UI layer under Node.
 *
 * Deliberately not jsdom: the UI uses a small, known slice of the DOM API, and a
 * ~90-line shim keeps the project at zero dependencies (Design.md D-11). If the
 * UI ever needs more of the platform than this covers, that is a signal to
 * reach for a real browser rather than to keep growing this file.
 *
 * Initial `hidden` state is parsed out of index.html rather than hard-coded, so
 * the shim cannot silently drift from the markup it is standing in for.
 */

class Node {
  constructor(tag) {
    this.tagName = (tag || '').toUpperCase();
    this.children = [];
    this._text = '';
    this.className = '';
    this.dataset = {};
    this.attrs = {};
    this.hidden = false;
    this.listeners = {};
    this.parent = null;
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }

  get textContent() {
    return this.children.length === 0
      ? this._text
      : this.children.map((c) => c.textContent).join('');
  }

  append(...nodes) {
    for (const node of nodes) {
      if (node && node.isFragment) {
        for (const child of node.children) {
          child.parent = this;
          this.children.push(child);
        }
      } else {
        node.parent = this;
        this.children.push(node);
      }
    }
  }

  replaceChildren(...nodes) {
    this.children = [];
    this._text = '';
    this.append(...nodes);
  }

  get classList() {
    const node = this;
    const list = () => node.className.split(/\s+/).filter(Boolean);
    return {
      add: (c) => { if (!list().includes(c)) node.className = [...list(), c].join(' '); },
      remove: (c) => { node.className = list().filter((x) => x !== c).join(' '); },
      contains: (c) => list().includes(c),
    };
  }

  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  removeAttribute(name) { delete this.attrs[name]; }
  focus() { globalThis.document.activeElement = this; }

  contains(other) {
    if (other === this) return true;
    for (const child of this.children) if (child.contains && child.contains(other)) return true;
    return false;
  }

  addEventListener(type, handler) {
    (this.listeners[type] ||= []).push(handler);
  }

  /** Dispatch to this node's own listeners. Bubbling is simulated by the caller. */
  dispatch(type, event = {}) {
    for (const handler of this.listeners[type] || []) {
      handler({ preventDefault() {}, stopPropagation() {}, target: this, ...event });
    }
  }

  /**
   * Supports the selector forms the UI actually uses: a tag name, a class, or a
   * `[data-x]` attribute. Deliberately not a real selector engine.
   */
  querySelectorAll(selector) {
    const matches = (node) => {
      if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
      if (selector.startsWith('[data-')) {
        return node.dataset[selector.replace(/^\[data-/, '').replace(/\]$/, '')] !== undefined;
      }
      return node.tagName === selector.toUpperCase();
    };
    const out = [];
    const walk = (node) => {
      for (const child of node.children) {
        if (matches(child)) out.push(child);
        walk(child);
      }
    };
    walk(this);
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  /** Supports the `[data-x]` form the UI uses for event delegation. */
  closest(selector) {
    const key = selector.replace(/^\[data-/, '').replace(/\]$/, '');
    let node = this;
    while (node) {
      if (node.dataset && node.dataset[key] !== undefined) return node;
      node = node.parent;
    }
    return null;
  }
}

/**
 * @param {string[]} ids element ids the application looks up
 * @param {string} html contents of index.html, used to seed `hidden`
 * @returns {Map<string, Node>}
 */
export function installDOM(ids, html = '') {
  // Seed each node from its real tag in the markup: the `hidden` attribute plus
  // every other attribute present. Anything the page declares -- aria-expanded,
  // aria-controls, role -- is therefore true in the shim as well, so a test
  // cannot pass against markup that does not actually carry it.
  const declared = new Map();
  for (const match of html.matchAll(/<[a-z][^>]*\bid="([^"]+)"[^>]*>/gi)) {
    const attrs = {};
    for (const attr of match[0].matchAll(/([a-z-]+)="([^"]*)"/gi)) attrs[attr[1]] = attr[2];
    declared.set(match[1], { attrs, hidden: /\shidden[\s>/]/.test(match[0]) });
  }

  const registry = new Map();
  for (const id of ids) {
    const node = new Node('div');
    const seed = declared.get(id);
    if (seed) {
      node.hidden = seed.hidden;
      for (const [name, value] of Object.entries(seed.attrs)) {
        if (name === 'id' || name === 'hidden') continue;
        if (name === 'class') node.className = value;
        else node.attrs[name] = value;
      }
    }
    registry.set(id, node);
  }

  const documentListeners = {};
  globalThis.document = {
    activeElement: null,
    addEventListener: (type, handler) => { (documentListeners[type] ||= []).push(handler); },
    /** Test-only: drive the document-level handlers the UI registers. */
    dispatch: (type, event = {}) => {
      for (const handler of documentListeners[type] || []) {
        handler({ preventDefault() {}, stopPropagation() {}, ...event });
      }
    },
    // The shim has no document tree, so a document-level query can only answer
    // for registered ids. `header.masthead` is looked up by the app for the
    // sticky bar; it resolves to null here and the bar is simply never shown,
    // which is correct for an environment with no layout.
    querySelector: () => null,
    /** Custom properties the app sets on the root, so tests can read them back. */
    documentElement: {
      _props: {},
      style: {
        setProperty(name, value) { globalThis.document.documentElement._props[name] = value; },
        getPropertyValue(name) { return globalThis.document.documentElement._props[name] ?? ''; },
      },
    },
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => {
      const node = new Node('#text');
      node.textContent = text;
      return node;
    },
    createDocumentFragment: () => {
      const node = new Node('#fragment');
      node.isFragment = true;
      return node;
    },
    getElementById: (id) => registry.get(id) ?? null,
  };

  return registry;
}

/** Intl separates a currency code from its number with U+00A0, not a space. */
export const NBSP = ' ';
export const normaliseSpaces = (s) => s.split(NBSP).join(' ');
