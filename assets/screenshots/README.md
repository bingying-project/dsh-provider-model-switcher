# Screenshots

`../screenshots.json` is read by the awesome-dsh-plugin site build, which looks
for `screenshots.json` **beside `package.json`** in this repository, resolves the
relative paths against this repo at `HEAD`, and renders them AppStore-style on the
plugin's detail page. No pull request upstream is involved: push here and the next
build picks it up.

Rules enforced upstream (`scripts/probe-screenshots.mjs` in that repo):

- at most **8** images;
- relative paths must stay inside this repository — no `..`, no absolute paths;
- absolute URLs are allowed only on GitHub hosting (`raw.githubusercontent.com`,
  `github.com/user-attachments`, …), never a third-party host;
- an image that 404s is dropped from the published data, it does not fail the
  build — so a broken link is quiet, which is exactly why `test/screenshots-spec.cjs`
  exists here.

## What to capture

Three beats, in this order. The filenames are already wired into
`../screenshots.json`, so matching them is the whole job.

| File | Shot | Why it earns its place |
| --- | --- | --- |
| `01-native-label-shows-provider.png` | Composer at rest: the native model seat reading `provider · model`, with the picker entry directly to its left. | Proves the plugin is additive — the platform's own button is still doing the work, it just says more. |
| `02-picker-grouped-by-provider.png` | The picker open: several providers as rows, one expanded showing that provider's models with the current one highlighted. | This is the actual feature. Needs **at least two providers configured** or the grouping is invisible. |
| `03-edit-jumps-to-provider-settings.png` | Settings → Models, arrived at by clicking a provider row's edit button, with that provider's Base URL / API key / model list in view. | The half of the feature a screenshot can prove at all: one click, right page, right provider. |

## How to take them

1. Set up two providers in Settings → Models first (one can be a throwaway base
   URL); a single provider makes shot 2 look like the stock picker.
2. `Win` + `Shift` + `S` → rectangular snip → paste into any editor → export PNG.
3. Crop tight to the composer / settings panel. No desktop, no taskbar, no other
   windows: the carousel is small and a full-screen grab reads as noise.
4. Width 1200–1600 px, height whatever the crop gives. Retina/125% scaling is
   fine, just keep it under 2 MiB per file.

## Before committing

Anything visible in these images is published to a public storefront. Check:

- no API key, no token, no `sk-…` string in any field;
- no account email, avatar, or org name in the window chrome;
- no internal base URLs you would not put on a slide;
- if a key has to be visible for the shot to make sense, replace it with a
  placeholder like `sk-REDACTED` first.

Then:

```bash
node test/screenshots-spec.cjs   # shape, size, dimensions, and the files themselves
node test/market-check.cjs       # re-runs the submission gate
```
