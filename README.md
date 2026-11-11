# dsh-provider-model-switcher

A **provider-first model picker** for the DSH (DeepSeek Harness) composer.

DSH's native model button lists models flat, so once several providers are
configured you cannot tell which provider a model name belongs to, and changing
a provider's base URL or key means leaving the conversation for Settings.

This plugin adds two **purely additive** contributions — it replaces no platform
control:

1. **The native model seat's label becomes `provider · model`**, so the trigger
   always names the provider that owns the selection.
2. **A picker sits directly left of it.** Each configured provider is one row;
   expanding a row lists that provider's models for one-click switching, and the
   row's edit button jumps straight to **Settings → Models** so a base URL, key,
   or model list can be updated without hunting through menus.

Everything reads and writes through the platform's own per-session model
directory (`ctx.modelDirectories`) — the same instance the native control uses —
so a switch made here is instantly reflected by the native seat.

## Install

Requires DSH `0.2.2-rc.1` or a compatible `0.2.x` build.

**From the sidebar (recommended)**

1. Open **Plugins** in the DSH sidebar.
2. Click **Add plugin**, enter `dsh-provider-model-switcher`, then **Enable now**.

The bundle is enabled automatically — no configuration file edits.

**From the CLI**

```bash
dsh plugin --profile desktop add dsh-provider-model-switcher
```

**From a Git repository**

In **Add plugin → Install a third-party plugin**, paste either form:

```
github:bingying-project/dsh-provider-model-switcher
https://github.com/bingying-project/dsh-provider-model-switcher
```

A bare `owner/repo` is **not** accepted — DSH reads it as a registry package
name and rejects it. Pin a release with a fragment: `github:bingying-project/dsh-provider-model-switcher#v1.0.0`.

**From a local tarball or checkout**

Use **Add plugin → Install a third-party plugin** and paste an absolute path, or:

```bash
dsh plugin --profile desktop add /absolute/path/to/dsh-provider-model-switcher-1.0.0.tgz
```

## Use

- The model button in the composer now reads `provider · model`.
- Click the slider icon to its left to open the provider-first picker.
- Click a provider row to expand its models; click a model to switch.
- Click **Edit** on a provider row (or **Models settings** at the panel's top
  right) to open Settings → Models.

## Uninstall

```bash
dsh plugin --profile desktop remove dsh-provider-model-switcher
```

Or switch the bundle off on the sidebar **Plugins** page. Uninstalling restores
the composer to its stock behaviour; no other files are touched.

## Compatibility and failure behavior

- Pure client plugin: no host capability, no network calls, no telemetry.
- Every optional platform service (`modelDirectories`, `locale`, `shortcuts`) is
  probed before use. A missing one degrades the affected feature to a no-op and
  never breaks the composer.
- `engines.dsh` pins the tested host range. On an incompatible host the plugin
  manager reports the mismatch instead of loading it.

## License

MIT
