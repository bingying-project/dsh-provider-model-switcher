// Browser half of the provider-model-switcher bundle.
//
// Adds two additive contributions to the DSH composer; neither replaces a
// platform control:
//
//   1. `conversation.input.model.label` (single, session, inline)
//      Fills the native model seat's label with "provider · model", so the
//      trigger always names the provider that owns the selected model.
//
//   2. `conversation.input.right` (list, session)
//      A compact provider button rendered directly left of the native model
//      seat. It opens a provider-first picker: every configured provider is a
//      row with its own edit button (jumps to Settings → Models) and expands to
//      that provider's models for one-click selection.
//
// Data and writes go through the platform's own per-session model directory
// (`ctx.modelDirectories`), the same instance the native seat uses, so a switch
// made here is what the native control shows next. `session.selectModel`
// itself is never called directly.

window.__ModuleLoader__.load({
  id: 'dsh-provider-model-switcher',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;
    const { useState, useEffect, useCallback, useRef } = React;

    /** Dictionary namespace owned by this plugin. */
    const NS = 'providerModelSwitcher';
    /** Injected <style> element id. */
    const STYLE_ID = 'dsh-pms-styles';
    /** Nav labels the Models settings section ships, used to land on it. */
    const SECTION_ALIASES = ['Models', '模型', 'モデル', 'Модели', 'Modelos', 'Modèles', 'Modelle'];
    /** Settings dialog marker; the shell stamps it on its panel element. */
    const SETTINGS_PANEL_SELECTOR = '[data-shortcut-modal="settings"]';
    /** Accessible names the Settings trigger ships, used by the DOM fallback. */
    const SETTINGS_ALIASES = ['设置', '設定', 'Settings', 'Настройки', 'Configuración', 'Paramètres', 'Einstellungen', 'Configurações'];

    const zh = {
      seat: '供应商与模型',
      title: '选择模型',
      openSettings: '模型设置',
      edit: '编辑',
      editProvider: '编辑 {provider}',
      loading: '正在读取模型目录…',
      empty: '暂无可用模型，请先在设置中配置供应商',
      failed: '模型目录读取失败',
      selectFailed: '切换模型失败',
      manual: '请从「设置 → 模型」打开',
      count: '{count} 个',
      current: '当前',
    };

    const en = {
      seat: 'Provider and model',
      title: 'Select model',
      openSettings: 'Model settings',
      edit: 'Edit',
      editProvider: 'Edit {provider}',
      loading: 'Reading the model catalog…',
      empty: 'No models available. Configure a provider in Settings first.',
      failed: 'Could not read the model catalog',
      selectFailed: 'Could not switch model',
      manual: 'Open Settings → Models',
      count: '{count}',
      current: 'Current',
    };

    const CSS = `
.dsh-pms-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:28px;
  min-width:28px;padding:0 7px;border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));
  border-radius:7px;background:transparent;color:var(--dsw-alias-label-primary,currentColor);
  font:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap}
.dsh-pms-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));
  border-color:var(--dsw-alias-border-l2,var(--dsw-alias-border-l1,rgba(0,0,0,.2)))}
.dsh-pms-btn[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-active,rgba(0,0,0,.07))}
.dsh-pms-btn:disabled{opacity:.5;cursor:default}
.dsh-pms-btn svg{display:block}

.dsh-pms-panel{position:fixed;z-index:1400;width:302px;max-width:calc(100vw - 24px);
  max-height:min(62vh,440px);display:flex;flex-direction:column;overflow:hidden;
  background:var(--dsw-alias-bg-layer-3,#fff);color:var(--dsw-alias-label-primary,inherit);
  border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:10px;
  box-shadow:0 10px 34px rgba(0,0,0,.18);font-size:13px}
.dsh-pms-head{display:flex;align-items:center;gap:8px;padding:9px 10px 7px 12px;
  color:var(--dsw-alias-label-secondary,inherit);font-size:11px;font-weight:600;
  letter-spacing:.02em;flex:0 0 auto}
.dsh-pms-head-title{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pms-link{border:none;background:transparent;padding:3px 5px;border-radius:6px;
  color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:11px;cursor:pointer}
.dsh-pms-link:hover{color:var(--dsw-alias-brand-primary,#4d6bfe);
  background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dsh-pms-body{overflow:auto;padding:2px 6px 8px;flex:1 1 auto}
.dsh-pms-group{margin:2px 0}
.dsh-pms-grouprow{display:flex;align-items:center;gap:6px;width:100%;padding:7px 6px;
  border:none;background:transparent;color:inherit;font:inherit;font-size:12px;
  text-align:left;cursor:pointer;border-radius:7px}
.dsh-pms-grouprow:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dsh-pms-caret{display:inline-flex;color:var(--dsw-alias-menu-icon,currentColor);
  transition:transform .12s ease;flex:0 0 auto}
.dsh-pms-caret[data-open="true"]{transform:rotate(90deg)}
.dsh-pms-pname{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dsh-pms-pcount{flex:0 0 auto;color:var(--dsw-alias-label-secondary,inherit);
  font-size:11px;font-variant-numeric:tabular-nums}
.dsh-pms-edit{display:inline-flex;align-items:center;gap:3px;flex:0 0 auto;border:none;
  background:transparent;padding:3px 5px;border-radius:6px;
  color:var(--dsw-alias-label-secondary,inherit);font:inherit;font-size:11px;cursor:pointer}
.dsh-pms-edit:hover{color:var(--dsw-alias-brand-primary,#4d6bfe);
  background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05))}
.dsh-pms-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 8px 6px 26px;
  border:none;background:transparent;color:inherit;font:inherit;font-size:13px;
  text-align:left;cursor:pointer;border-radius:7px}
.dsh-pms-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.dsh-pms-item[aria-selected="true"]{color:var(--dsw-alias-brand-primary,#4d6bfe)}
.dsh-pms-mname{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-pms-tick{display:inline-flex;flex:0 0 auto}
.dsh-pms-msg{padding:12px 10px;color:var(--dsw-alias-label-secondary,inherit);
  font-size:12px;line-height:1.5}
.dsh-pms-err{color:var(--dsw-alias-label-danger,#d33);padding:8px 10px;font-size:12px}
.dsh-pms-label{display:inline-flex;align-items:baseline;gap:0;min-width:0;max-width:100%}
.dsh-pms-lprov{flex:0 0 auto;color:var(--dsw-alias-label-secondary,inherit)}
.dsh-pms-lsep{flex:0 0 auto;color:var(--dsw-alias-label-secondary,inherit);opacity:.7}
.dsh-pms-lmodel{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}

.dsh-pms-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:2000;
  max-width:80vw;padding:8px 12px;border-radius:8px;font-size:12px;line-height:1.45;
  background:var(--dsw-alias-bg-layer-3,#222);color:var(--dsw-alias-label-primary,#fff);
  border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.28));
  box-shadow:0 8px 24px rgba(0,0,0,.22);pointer-events:none}
`;

    const NOOP = () => {};

    /** Diagnostics must never break the plugin. */
    function report(error) {
      try {
        console.error('[provider-model-switcher] ' + ((error && (error.stack || error.message)) || String(error)));
      } catch (ignored) { /* ignore */ }
    }

    /** Read an optional service without throwing when it is absent. */
    function optionalService(ctx, name) {
      try {
        return ctx.get(name);
      } catch (error) {
        return undefined;
      }
    }

    /** Fallback translator used when the locale service is unavailable. */
    function makeFallbackT() {
      return (key, params) => {
        const language = (typeof navigator !== 'undefined' && navigator.language) || 'en';
        const dict = /^zh/i.test(language) ? zh : en;
        const text = dict[key] === undefined ? key : dict[key];
        if (!params) return text;
        return text.replace(/\{(\w+)\}/g, (whole, token) => (params[token] === undefined ? whole : String(params[token])));
      };
    }

    /** Active translator; replaced by the locale-bound one in apply. */
    let t = makeFallbackT();

    function ensureStyle() {
      try {
        if (document.getElementById(STYLE_ID)) return;
        const element = document.createElement('style');
        element.id = STYLE_ID;
        element.textContent = CSS;
        (document.head || document.documentElement).appendChild(element);
      } catch (error) {
        report(error);
      }
    }

    function removeStyle() {
      try {
        const element = document.getElementById(STYLE_ID);
        if (element !== null) element.remove();
      } catch (error) {
        /* ignore */
      }
    }

    /* ------------------------------------------------------------------ *
     * Navigation: Settings → Models
     * ------------------------------------------------------------------ */

    /** Transient, non-blocking hint; used only when a jump cannot complete. */
    function flash(message) {
      try {
        const element = document.createElement('div');
        element.className = 'dsh-pms-toast';
        element.setAttribute('role', 'status');
        element.textContent = message;
        (document.body || document.documentElement).appendChild(element);
        setTimeout(() => {
          try { element.remove(); } catch (ignored) { /* ignore */ }
        }, 3600);
      } catch (error) {
        report(error);
      }
    }

    function findSettingsPanel() {
      try {
        return document.querySelector(SETTINGS_PANEL_SELECTOR);
      } catch (error) {
        return null;
      }
    }

    /** Click the Models row inside an already-open Settings dialog. */
    function activateModelsSection(panel) {
      const cells = Array.from(panel.querySelectorAll('nav button'));
      const labelOf = (cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim();
      const exact = cells.find((cell) => SECTION_ALIASES.includes(labelOf(cell)));
      const target = exact !== undefined
        ? exact
        : cells.find((cell) => SECTION_ALIASES.some((alias) => labelOf(cell).indexOf(alias) !== -1));
      if (target === undefined) return false;
      if (target.getAttribute('aria-current') === 'true') return true;
      target.click();
      return true;
    }

    /**
     * Fire the platform's own `settings.open` command.
     *
     * `ctx.shortcuts` is the service, but `invoke()` belongs to the registry it
     * owns (`ctx.shortcuts.registry`) — the service itself exposes no invoke.
     * The raw command is resolved by hand as a second attempt, so a build that
     * renames the registry still opens Settings.
     */
    function invokeSettingsCommand(shortcuts) {
      const context = { target: document.body, region: 'page', modal: null, source: 'menu' };
      const registry = shortcuts.registry;

      // Invoking a command that was never registered is a silent no-op, so the
      // command is looked up first; a miss falls through to the next probe.
      const commands = (registry && registry.commands) || shortcuts.commands;
      const command = commands && typeof commands.get === 'function' ? commands.get('settings.open') : undefined;
      if (command === undefined || command === null) return false;

      if (registry && typeof registry.invoke === 'function') {
        try {
          registry.invoke('settings.open', context);
          return true;
        } catch (error) {
          report(error);
        }
      }

      if (typeof command.resolve !== 'function') return false;

      try {
        const result = command.resolve(context);
        if (result && result.status === 'handled' && typeof result.run === 'function') {
          result.run();
          return true;
        }
      } catch (error) {
        report(error);
      }
      return false;
    }

    /** Last resort: click the Settings trigger the shell renders in the sidebar. */
    function clickSettingsTrigger() {
      let candidates;
      try {
        candidates = Array.from(document.querySelectorAll('button[aria-haspopup="dialog"]'));
      } catch (error) {
        return false;
      }
      const labelled = candidates.find((candidate) => SETTINGS_ALIASES.includes((candidate.getAttribute('aria-label') || '').trim()));
      const target = labelled !== undefined
        ? labelled
        : candidates.find((candidate) => candidate.getAttribute('aria-expanded') === 'false');
      if (target === undefined) return false;
      try {
        target.click();
        return true;
      } catch (error) {
        report(error);
        return false;
      }
    }

    /**
     * Bring the user to the Models settings page.
     *
     * Resolution order, most explicit first. Every step is optional so a build
     * that renames or drops one keeps the remaining path working; when all of
     * them miss, the user gets a hint instead of a dead click.
     */
    function openModelsSettings(ctx) {
      const alreadyOpen = findSettingsPanel();
      if (alreadyOpen !== null && activateModelsSection(alreadyOpen)) return true;

      // 1. A settings service exposing openSection directly (not present in
      //    0.2.2-rc.1, kept for forward compatibility).
      for (const serviceName of ['settingsShell', 'settingsNavigation', 'settingsUi']) {
        const service = optionalService(ctx, serviceName);
        const actions = service && (service.actions || service);
        if (actions && typeof actions.openSection === 'function') {
          try {
            actions.openSection('models');
            return true;
          } catch (error) {
            report(error);
          }
        }
      }

      // 2. The platform's own `settings.open` command.
      const shortcuts = optionalService(ctx, 'shortcuts');
      if (shortcuts !== undefined) invokeSettingsCommand(shortcuts);

      // 3. Wait for the dialog, then activate the Models row. The sidebar
      //    trigger is retried twice in case the command was unavailable.
      let attempts = 0;
      let triggerTries = 0;
      const tick = () => {
        attempts += 1;
        const panel = findSettingsPanel();
        if (panel !== null && activateModelsSection(panel)) return;

        if ((attempts === 8 || attempts === 22) && triggerTries < 2) {
          triggerTries += 1;
          clickSettingsTrigger();
        }

        if (attempts >= 46) {
          try {
            console.warn('[provider-model-switcher] Settings → Models is not reachable in this build');
          } catch (ignored) { /* ignore */ }
          flash(t('manual'));
          return;
        }
        setTimeout(tick, 50);
      };
      setTimeout(tick, 40);
      return true;
    }

    /* ------------------------------------------------------------------ *
     * Icons
     * ------------------------------------------------------------------ */

    function IconSliders() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none' },
        h('path', { d: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
        h('circle', { cx: 6, cy: 4.5, r: 1.7, fill: 'var(--dsw-alias-bg-layer-3,#fff)', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('circle', { cx: 10.5, cy: 8, r: 1.7, fill: 'var(--dsw-alias-bg-layer-3,#fff)', stroke: 'currentColor', strokeWidth: 1.3 }),
        h('circle', { cx: 5, cy: 11.5, r: 1.7, fill: 'var(--dsw-alias-bg-layer-3,#fff)', stroke: 'currentColor', strokeWidth: 1.3 }),
      );
    }

    function IconCaret() {
      return h('svg', { width: 10, height: 10, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none' },
        h('path', { d: 'M6 3.5 10.5 8 6 12.5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    function IconPencil() {
      return h('svg', { width: 11, height: 11, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none' },
        h('path', {
          d: 'M11.3 1.9a1.6 1.6 0 0 1 2.3 0l.5.5a1.6 1.6 0 0 1 0 2.3L5.2 13.6 2 14.4l.8-3.2 8.5-8.5z',
          stroke: 'currentColor',
          strokeWidth: 1.3,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
        }),
      );
    }

    function IconCheck() {
      return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none' },
        h('path', { d: 'M2.8 8.6 6.2 12l7-8.2', stroke: 'currentColor', strokeWidth: 1.9, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      );
    }

    /* ------------------------------------------------------------------ *
     * Contribution 1: the native seat's label
     * ------------------------------------------------------------------ */

    /**
     * Inline label for the platform's model seat (trigger, menu value, and each
     * option). The platform owns every interaction here; this only paints text.
     *
     * It never returns null: a registered contribution replaces the built-in
     * label even when it renders nothing, so an empty result would blank the
     * trigger. Model options already sit under a provider heading in the
     * platform menu, so only the trigger and the root-menu value repeat the
     * provider name.
     */
    function ModelLabel(props) {
      const provider = props.provider;
      const model = props.model;
      const providerName = (provider && (provider.name || provider.id)) || '';
      const modelName = (model && (model.name || model.id)) || '';
      const showProvider = providerName !== '' && props.placement !== 'option';

      if (!showProvider) {
        return h('span', { className: 'dsh-pms-label', title: modelName },
          h('span', { className: 'dsh-pms-lmodel' }, modelName),
        );
      }

      return h('span', { className: 'dsh-pms-label', title: providerName + ' · ' + modelName },
        h('span', { className: 'dsh-pms-lprov' }, providerName),
        h('span', { className: 'dsh-pms-lsep' }, ' · '),
        h('span', { className: 'dsh-pms-lmodel' }, modelName),
      );
    }

    /* ------------------------------------------------------------------ *
     * Contribution 2: provider picker
     * ------------------------------------------------------------------ */

    const EMPTY_SNAPSHOT = {
      current: null,
      routable: null,
      groups: [],
      failures: [],
      status: 'idle',
      pending: null,
      error: null,
    };

    function readSnapshot(directory) {
      try {
        return directory.store.getSnapshot();
      } catch (error) {
        report(error);
        return EMPTY_SNAPSHOT;
      }
    }

    function subscribeTo(directory, listener) {
      try {
        return directory.store.subscribe(listener);
      } catch (error) {
        report(error);
        return NOOP;
      }
    }

    /**
     * The provider-first picker: every configured provider is a row with an
     * edit button, and expands to its models for one-click selection.
     */
    function ProviderSeat(props) {
      const t = props.t;
      const directory = props.directory;
      const openSettings = props.openSettings;
      const locked = props.locked === true;

      const [open, setOpen] = useState(false);
      const [expanded, setExpanded] = useState(null);
      const [position, setPosition] = useState(null);
      const [actionError, setActionError] = useState(null);

      const buttonRef = useRef(null);
      const panelRef = useRef(null);

      const available = directory !== undefined && directory !== null;

      const subscribe = useCallback(
        (listener) => (available ? subscribeTo(directory, listener) : NOOP),
        [directory, available],
      );
      const getSnapshot = useCallback(
        () => (available ? readSnapshot(directory) : EMPTY_SNAPSHOT),
        [directory, available],
      );
      const snapshot = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

      const groups = Array.isArray(snapshot.groups) ? snapshot.groups : [];
      const current = snapshot.current;
      const status = snapshot.status;

      // Load the directory once per session; failures stay on the store.
      useEffect(() => {
        if (!available) return;
        Promise.resolve()
          .then(() => directory.load())
          .catch(report);
      }, [directory, available]);

      // Open on the provider that owns the current model.
      useEffect(() => {
        if (!open) return;
        if (expanded !== null) return;
        if (current === null) return;
        setExpanded(current.provider);
      }, [open, expanded, current]);

      const place = useCallback(() => {
        const button = buttonRef.current;
        const panel = panelRef.current;
        if (button === null || panel === null) return;
        const rect = button.getBoundingClientRect();
        const width = panel.offsetWidth;
        const height = panel.offsetHeight;
        const margin = 12;
        const gap = 8;

        let left = rect.right - width;
        if (left + width > window.innerWidth - margin) left = window.innerWidth - width - margin;
        if (left < margin) left = margin;

        let top = rect.top - height - gap;
        if (top < margin) top = rect.bottom + gap;
        if (top + height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - height - margin);

        setPosition({ left, top });
      }, []);

      useEffect(() => {
        if (!open) {
          setPosition(null);
          return;
        }
        const frame = requestAnimationFrame(place);
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
          cancelAnimationFrame(frame);
          window.removeEventListener('resize', place);
          window.removeEventListener('scroll', place, true);
        };
      }, [open, place]);

      useEffect(() => {
        if (!open) return;
        const onPointerDown = (event) => {
          const panel = panelRef.current;
          const button = buttonRef.current;
          if (panel !== null && panel.contains(event.target)) return;
          if (button !== null && button.contains(event.target)) return;
          setOpen(false);
        };
        const onKeyDown = (event) => {
          if (event.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onPointerDown, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
          document.removeEventListener('mousedown', onPointerDown, true);
          document.removeEventListener('keydown', onKeyDown);
        };
      }, [open]);

      const choose = useCallback(
        async (providerId, modelId) => {
          if (!available) return;
          setActionError(null);
          try {
            const result = await directory.select({ provider: providerId, model: modelId });
            if (result && result.ok === false) {
              const detail = result.error ? result.error.code + ': ' + result.error.message : '';
              setActionError(t('selectFailed') + (detail ? '（' + detail + '）' : ''));
              return;
            }
            setOpen(false);
          } catch (error) {
            report(error);
            setActionError(t('selectFailed'));
          }
        },
        [directory, available, t],
      );

      const jump = useCallback(() => {
        setOpen(false);
        try {
          openSettings();
        } catch (error) {
          report(error);
        }
      }, [openSettings]);

      if (!available) return null;

      const currentLabel = (() => {
        if (current === null) return t('seat');
        const group = groups.find((item) => item.id === current.provider);
        return (group && (group.name || group.id)) || current.provider;
      })();

      const renderGroup = (group) => {
        const models = Array.isArray(group.models) ? group.models : [];
        const isOpen = expanded === group.id;
        const name = group.name || group.id;
        return h('div', { className: 'dsh-pms-group', key: group.id },
          h('div', { className: 'dsh-pms-grouprow', role: 'button', tabIndex: 0,
            'aria-expanded': isOpen ? 'true' : 'false',
            onClick: () => setExpanded(isOpen ? null : group.id),
            onKeyDown: (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                setExpanded(isOpen ? null : group.id);
              }
            },
          },
            h('span', { className: 'dsh-pms-caret', 'data-open': isOpen ? 'true' : 'false' }, h(IconCaret)),
            h('span', { className: 'dsh-pms-pname', title: name }, name),
            h('span', { className: 'dsh-pms-pcount' }, t('count', { count: models.length })),
            h('button', {
              type: 'button',
              className: 'dsh-pms-edit',
              title: t('editProvider', { provider: name }),
              'aria-label': t('editProvider', { provider: name }),
              onClick: (event) => {
                event.stopPropagation();
                jump();
              },
            }, h(IconPencil), h('span', null, t('edit'))),
          ),
          isOpen
            ? models.map((model) => {
                const selected = current !== null && current.provider === group.id && current.model === model.id;
                const pending = snapshot.pending !== null
                  && snapshot.pending !== undefined
                  && snapshot.pending.provider === group.id
                  && snapshot.pending.model === model.id;
                return h('button', {
                  type: 'button',
                  key: model.id,
                  role: 'option',
                  className: 'dsh-pms-item',
                  'aria-selected': selected ? 'true' : 'false',
                  disabled: locked || pending,
                  title: model.name || model.id,
                  onClick: () => { choose(group.id, model.id); },
                },
                  h('span', { className: 'dsh-pms-mname' }, model.name || model.id),
                  selected ? h('span', { className: 'dsh-pms-tick', title: t('current') }, h(IconCheck)) : null,
                );
              })
            : null,
        );
      };

      const body = (() => {
        if (groups.length === 0) {
          if (status === 'error') {
            return h('div', { className: 'dsh-pms-msg' }, t('failed'), snapshot.error ? h('div', null, String(snapshot.error)) : null);
          }
          if (status === 'loading' || status === 'idle') {
            return h('div', { className: 'dsh-pms-msg' }, t('loading'));
          }
          return h('div', { className: 'dsh-pms-msg' }, t('empty'));
        }
        return groups.map(renderGroup);
      })();

      const panel = open
        ? h('div', {
            ref: panelRef,
            className: 'dsh-pms-panel',
            role: 'listbox',
            'aria-label': t('title'),
            style: position === null
              ? { visibility: 'hidden', left: 0, top: 0 }
              : { left: position.left + 'px', top: position.top + 'px' },
          },
            h('div', { className: 'dsh-pms-head' },
              h('span', { className: 'dsh-pms-head-title' }, t('title')),
              h('button', { type: 'button', className: 'dsh-pms-link', onClick: jump }, t('openSettings')),
            ),
            actionError !== null ? h('div', { className: 'dsh-pms-err' }, actionError) : null,
            h('div', { className: 'dsh-pms-body' }, body),
          )
        : null;

      const portaled = panel !== null && ReactDOM && typeof ReactDOM.createPortal === 'function'
        ? ReactDOM.createPortal(panel, document.body)
        : panel;

      return h('span', { style: { display: 'inline-flex', maxWidth: '100%' } },
        h('button', {
          ref: buttonRef,
          type: 'button',
          className: 'dsh-pms-btn',
          title: currentLabel,
          'aria-label': t('seat') + ': ' + currentLabel,
          'aria-haspopup': 'listbox',
          'aria-expanded': open ? 'true' : 'false',
          disabled: locked,
          onClick: () => {
            setActionError(null);
            setOpen((value) => !value);
          },
        }, h(IconSliders)),
        portaled,
      );
    }

    /* ------------------------------------------------------------------ *
     * Plugin apply
     * ------------------------------------------------------------------ */

    const inject = ['slots', 'locale'];

    function apply(ctx) {
      ensureStyle();
      ctx.effect(() => () => removeStyle(), 'provider-model-switcher: styles');

      try {
        if (ctx.locale && typeof ctx.locale.register === 'function') {
          ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'provider-model-switcher: dictionaries');
          const bound = ctx.locale.bind(NS);
          if (typeof bound === 'function') t = bound;
        }
      } catch (error) {
        report(error);
      }

      // 1. Provider name inside the native model seat's label.
      ctx.effect(() => ctx.slots.inject('conversation.input.model.label', () => ctx.slots.register(
        { name: 'conversation.input.model.label' },
        ModelLabel,
      )), 'provider-model-switcher: model label');

      // 2. The provider picker. `modelDirectories` is optional on purpose: if
      //    the platform's model-selection plugin is absent, only this half is
      //    skipped and the label above still works.
      ctx.effect(() => ctx.inject(['modelDirectories'], (scope) => {
        const models = scope.modelDirectories;
        if (!models || typeof models.directoryFor !== 'function') return;

        scope.slots.inject('conversation.input.right', () => scope.slots.register({
          name: 'conversation.input.right',
          id: 'provider-model-switcher',
          order: 10,
          inject: (sessionId) => {
            let directory;
            try {
              directory = models.directoryFor(sessionId);
            } catch (error) {
              report(error);
              directory = undefined;
            }
            return {
              sessionId,
              directory,
              t,
              openSettings: () => openModelsSettings(scope),
            };
          },
        }, ProviderSeat));
      }), 'provider-model-switcher: provider picker');
    }

    return { inject, apply };
  },
});
