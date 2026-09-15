# Satoru EMR patch — what this repo is

This is **not** stock CHT Core, and it is **not** a GitHub fork.

It is `medic/cht-core` at tag **5.3.0** (the root commit, byte-identical to
upstream) plus two commits that add readable assessment reports and a
Print / Save-as-PDF button for the Satoru EMR screening workflow.

Upstream, with real history: https://github.com/medic/cht-core

## What the patch does

DDST-II / DST / MoCA / VSMS reports render with human labels and values
instead of raw field keys — `1. Cries, laughs → Yes` rather than
`report.vineland.g_y0_1.item_1 → yes` — and the expanded report gets a
**Print / Save as PDF** action.

| File | |
|---|---|
| `webapp/src/ts/services/format-data-record.service.ts` | hide internal/calc fields, resolve choice values to form labels, join chronological age, attach per-item scores, format dates, suppress empty rows |
| `webapp/src/ts/services/print-report.service.ts` *(new)* | renders the same rows into a print view and calls `window.print()` |
| `webapp/src/ts/modules/reports/reports-content.component.{ts,html}` | the button |
| `webapp/src/css/inbox.less` | button style, hidden in `@media print` |

**It is inert without configuration.** Everything is driven by
`settings.report_display[<form>]`. A form with no entry renders exactly as
stock CHT does, so this is safe for any other deployment — but it also
means the patch alone does nothing.

## You also need the config repo

`report_display` and the `report.*` labels are generated from the form XMLs
by the companion repo, which also holds the forms, translations, Excel
exports and the Docker overlay:

**https://github.com/donthireddysaivarshini/satoruemr** — branch
`feat/exports-and-deploy`

Full setup instructions live there in `SETUP.md`. Clone the two side by side:

```
EMRCHT/
  cht-core/    this repo
  satoruemr/   the config repo
```

## Two traps, if you build this yourself

**Run 5.3.0 images, not 5.2.0.** The webapp calls
`POST /api/v1/report/summary`, which the 5.2.0 API does not have. Against
5.2.0 it 404s and the Reports view hangs on a spinner forever.

**Build with `--configuration=production`.** `webapp/angular.json` sets
`defaultConfiguration: None`, so a bare `ng build` inlines "critical CSS"
into `index.html`. That inlined `.bootstrap-layer{display:flex}` is
unlayered and beats `.bootstrapped .bootstrap-layer{display:none}`, leaving
the app behind a permanent loading spinner with the real UI rendered
underneath it. Production sets `inlineCritical:false`.

```bash
npx sass webapp/src/css/enketo/enketo.scss api/build/static/webapp/enketo.less --no-source-map
cd webapp && npm ci && npm run build -- --configuration=production
```

Sanity check: the built `index.html` should be **~850 bytes**, not ~56 KB.
Node 22.x (cht-core requires >=22.15.0).

## Licence

CHT Core is licensed under the GNU Affero General Public License v3.0 —
see [LICENSE](LICENSE). These changes inherit it.
