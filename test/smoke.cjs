/**
 * Smoke test for the provider-model-switcher client bundle.
 *
 * Loads the bundle through a stubbed ModuleLoader + fake React/document, then
 * asserts activation, slot registration, graceful degradation, and that the
 * label contribution always renders an element (never null, which would blank
 * the platform's model trigger).
 */
const fs = require('node:fs');
const path = require('node:path');

const bundlePath = path.join(__dirname, '..', 'client.js');
const source = fs.readFileSync(bundlePath, 'utf8');

const ReactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useRef: () => ({ current: null }),
  useSyncExternalStore: () => ({
    current: null, routable: null, groups: [], failures: [], status: 'ready', pending: null, error: null,
  }),
};

const styleElements = [];
const documentStub = {
  head: { appendChild: (el) => styleElements.push(el) },
  documentElement: { appendChild: (el) => styleElements.push(el) },
  getElementById: () => null,
  createElement: () => ({ id: '', className: '', textContent: '', setAttribute() {}, remove() {} }),
  querySelector: () => null,
  addEventListener() {},
  removeEventListener() {},
  body: { appendChild() {} },
};

/** Deterministic clock: the plugin polls through setTimeout. */
const timers = [];
const flushTimers = (rounds) => {
  for (let index = 0; index < rounds; index += 1) {
    const batch = timers.splice(0, timers.length);
    if (batch.length === 0) return;
    for (const fn of batch) fn();
  }
};
const nativeSetTimeout = global.setTimeout;
global.setTimeout = (fn) => {
  timers.push(fn);
  return timers.length;
};

let loaded = null;
global.window = { __ModuleLoader__: { load: (entry) => { loaded = entry; } } };
global.document = documentStub;
global.navigator = { language: 'zh-CN' };
global.requestAnimationFrame = () => 0;
global.cancelAnimationFrame = () => {};

// eslint-disable-next-line no-new-func
new Function('window', 'document', 'navigator', source)(global.window, documentStub, global.navigator);

if (loaded === null) throw new Error('bundle did not call __ModuleLoader__.load');
if (loaded.id !== 'dsh-provider-model-switcher') throw new Error('unexpected bundle id: ' + loaded.id);

const moduleExports = loaded.factory((request) => {
  if (request === 'react') return ReactStub;
  if (request === 'react-dom') return { createPortal: (node) => node };
  return {};
});

if (typeof moduleExports.apply !== 'function') throw new Error('client bundle exports no apply()');
if (!Array.isArray(moduleExports.inject)) throw new Error('client bundle exports no inject array');

const components = new Map();
const registered = new Map();
const dispose = () => {};
let labels = [];

const makeCtx = ({ withDirectories, shortcuts }) => {
  const ctx = {
    effect: (fn) => {
      const result = fn();
      return typeof result === 'function' ? result : dispose;
    },
    inject: (services, callback) => {
      const scope = { ...ctx };
      if (withDirectories && services.includes('modelDirectories')) {
        scope.modelDirectories = {
          directoryFor: () => ({
            store: { getSnapshot: () => ({}), subscribe: () => dispose },
            load: async () => ({}),
            select: async () => ({ ok: true }),
          }),
        };
      }
      callback(scope);
      return dispose;
    },
    slots: {
      inject: (name, factory) => {
        labels.push(name);
        factory();
        return dispose;
      },
      register: (options, component) => {
        if (typeof options !== 'object' || options === null) throw new Error('register() needs options');
        if (typeof options.name !== 'string') throw new Error('register() needs a slot name');
        if (typeof component !== 'function') throw new Error('register() needs a component for ' + options.name);
        components.set(options.name, component);
        registered.set(options.name, options);
        return dispose;
      },
    },
    locale: { register: () => dispose, bind: () => (key) => key },
    get: (name) => (name === 'shortcuts' ? shortcuts : undefined),
  };
  return ctx;
};

// Case 1: normal host, model directory present.
moduleExports.apply(makeCtx({ withDirectories: true }));
for (const name of ['conversation.input.model.label', 'conversation.input.right']) {
  if (!labels.includes(name)) throw new Error('missing slot registration: ' + name);
  if (!components.has(name)) throw new Error('missing component for: ' + name);
}

// Case 2: model-selection plugin absent — the label must survive.
labels = [];
moduleExports.apply(makeCtx({ withDirectories: false }));
if (!labels.includes('conversation.input.model.label')) {
  throw new Error('label contribution must survive a missing modelDirectories service');
}
if (labels.includes('conversation.input.right')) {
  throw new Error('picker must not register without modelDirectories');
}

// Case 3: no locale service at all.
const bare = makeCtx({ withDirectories: true });
delete bare.locale;
moduleExports.apply(bare);

// Label behaviour: element in every placement, provider only outside options.
const ModelLabel = components.get('conversation.input.model.label');
const provider = { id: 'deepseek-official', name: 'DeepSeek' };
const model = { id: 'deepseek-chat', name: 'DeepSeek-V3.2' };

const trigger = ModelLabel({ provider, model, placement: 'trigger', selected: true });
if (!trigger || trigger.type !== 'span') throw new Error('label must render a span, got: ' + String(trigger));
if (trigger.props.className !== 'dsh-pms-label') throw new Error('label lost its class');

const option = ModelLabel({ provider, model, placement: 'option', selected: false });
if (!option || option.type !== 'span') throw new Error('option label must not be null');

const texts = (node) => (node.children || []).map((child) => (typeof child === 'string' ? child : texts(child))).join('');
const hasProviderNode = (node) => (node.children || []).some((child) => (
  child && typeof child === 'object'
    ? (child.props && child.props.className === 'dsh-pms-lprov') || hasProviderNode(child)
    : false
));

if (!texts(trigger).includes('DeepSeek')) throw new Error('trigger label must name the provider');
if (!hasProviderNode(trigger)) throw new Error('trigger label must render the provider node');
if (hasProviderNode(option)) throw new Error('option label must not render the provider node');
if (!texts(option).includes('DeepSeek-V3.2')) throw new Error('option label must still name the model');

// Defensive: missing provider still renders the model name.
const bare2 = ModelLabel({ provider: undefined, model, placement: 'trigger' });
if (!texts(bare2).includes('DeepSeek-V3.2')) throw new Error('label must fall back to the model name');

/* ------------------------------------------------------------------ *
 * Navigation: Settings → Models
 * ------------------------------------------------------------------ */

const PANEL = '[data-shortcut-modal="settings"]';
const jump = () => registered.get('conversation.input.right').inject('session-1').openSettings;

// Case A: the command is reachable only through `ctx.shortcuts.registry`; the
// service itself exposes no invoke(). This is the shape that used to be a dead
// click, so it is asserted explicitly.
const invocations = [];
documentStub.querySelector = () => null;
moduleExports.apply(makeCtx({
  withDirectories: true,
  shortcuts: {
    registry: {
      commands: new Map([['settings.open', { resolve: () => ({ status: 'handled', run: () => {} }) }]]),
      invoke: (id, context) => invocations.push([id, context]),
    },
  },
}));
jump()();
if (invocations.length !== 1) throw new Error('settings.open must go through ctx.shortcuts.registry.invoke');
if (invocations[0][0] !== 'settings.open') throw new Error('wrong command id: ' + invocations[0][0]);
if (invocations[0][1].modal !== null) throw new Error('settings.open must be invoked outside a modal');
timers.length = 0;

// Case B: registry without invoke() — the raw command is resolved by hand.
const ranCommand = [];
moduleExports.apply(makeCtx({
  withDirectories: true,
  shortcuts: {
    registry: {
      commands: new Map([['settings.open', { resolve: () => ({ status: 'handled', run: () => ranCommand.push(1) }) }]]),
    },
  },
}));
jump()();
if (ranCommand.length !== 1) throw new Error('the raw command must run when registry.invoke() is absent');
timers.length = 0;

// Case C: a dialog is already open — activate its Models row instead.
let clickedSection = false;
documentStub.querySelector = (selector) => (selector === PANEL
  ? {
      querySelectorAll: () => [{
        textContent: '模型',
        getAttribute: () => null,
        click: () => { clickedSection = true; },
      }],
    }
  : null);
moduleExports.apply(makeCtx({ withDirectories: true }));
jump()();
if (!clickedSection) throw new Error('an open dialog must be switched to the Models row');

// Case D: nothing reachable — no throw, and the user sees a hint.
documentStub.querySelector = () => null;
let hints = 0;
documentStub.body.appendChild = () => { hints += 1; };
moduleExports.apply(makeCtx({ withDirectories: true }));
jump()();
flushTimers(60);
if (hints === 0) throw new Error('an unreachable Settings page must surface a hint');

console.log('PASS  bundle id        : ' + loaded.id);
console.log('PASS  exports          : apply(), inject=' + JSON.stringify(moduleExports.inject));
console.log('PASS  slots            : conversation.input.model.label, conversation.input.right');
console.log('PASS  graceful absence : modelDirectories / locale');
console.log('PASS  style injected   : ' + (styleElements.length > 0));
console.log('PASS  label trigger    : "' + texts(trigger) + '"');
console.log('PASS  label option     : "' + texts(option) + '"');
console.log('PASS  jump via registry : settings.open invoked, modal=null');
console.log('PASS  jump fallbacks    : raw command / open dialog / hint');

global.setTimeout = nativeSetTimeout;
