/**
 * Host half of the provider-model-switcher bundle.
 *
 * This plugin is a pure Client feature: every part of it (the composer
 * trigger label and the provider picker) renders in the browser and reads the
 * model directory service the platform already provides. No Host capability is
 * needed, so nothing is registered here.
 *
 * Why the file exists at all: `@deepseek-ai/dsh-client-modules` composes the
 * browser boot graph from *enabled Loader entries*. A package needs a real
 * Host-side plugin row before its `dsh.client` bundle is served, so this module
 * stays a valid, side-effect-free Cordis plugin.
 */

/**
 * Composable-host entry point. Intentionally empty.
 */
export function apply() {}
