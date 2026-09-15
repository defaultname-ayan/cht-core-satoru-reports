# Satoru EMR — Runbook

Readable assessment reports, Print / Save as PDF, and Excel exports for
DDST-II, DST, MoCA and VSMS — how the pieces connect, and why cloning
alone changes nothing.

---

## If you are here because the Print button is missing

That symptom, together with raw UUIDs still showing in the report body,
has one cause: **the browser is being served a stock CHT bundle.** The
configuration side is working; the build side has not been deployed.

| | Evidence |
|---|---|
| ✅ | Labels read `Participant ID`, `Child Name` → translations are uploaded |
| ❌ | `Participant 01a04761-7b5d-…` still visible → `patient_uuid` is in the hide list, so the patch is **not** running |
| ❌ | `Submitted by (user ID) 3e8ef37a…` still visible → same |
| ❌ | No Print / Save as PDF button → it ships inside the bundle |

**Fix: Step 1 below. Steps 2 and 3 are already done.**

> Stock CHT also resolves `report.*` keys through its translate pipe, which
> is why the labels look correct even with no patch deployed. Human labels
> alone do **not** prove the patch is running — the hidden fields do.

---

## 1. Why cloning changes nothing

CHT serves a **compiled** JavaScript bundle from inside the `api` Docker
container. It never reads the source tree at runtime. Three layers sit
between a git clone and what a nurse sees, and a clone only touches the
first.

```
  ┌──────────────────────────────────────────────────────────┐
  │ LAYER 1   The source tree                                │
  │           What `git clone` gives you. TypeScript, Less.  │
  └──────────────────────────────────────────────────────────┘
        ↓   npm run build      ← the step almost everyone misses
  ┌──────────────────────────────────────────────────────────┐
  │ LAYER 2   The compiled bundle                            │
  │           main.js, styles.css, index.html.               │
  │           This is what a browser actually runs.          │
  └──────────────────────────────────────────────────────────┘
        ↓   docker cp + restart
  ┌──────────────────────────────────────────────────────────┐
  │ LAYER 3   The running container                          │
  │           What every user is served. Until the bundle    │
  │           lands here, nothing has changed for anyone.    │
  └──────────────────────────────────────────────────────────┘
```

On top of that, the report rendering is **config-gated**. The patch only
activates for a form listed in `settings.report_display`, and that config
lives in the other repo and is uploaded to CouchDB separately. A perfectly
built bundle with no config still renders raw field keys.

---

## 2. The three things that must happen

A genuine sequence — each is necessary, and missing any one looks
identical from the outside: "nothing changed".

### Step 1 — Build the webapp and deploy it into the container

*Gives you: the Print / Save as PDF button, hidden internal fields,
resolved answers (`yes` → `Yes`).*

```bash
# from the cht-core repo root
npx sass webapp/src/css/enketo/enketo.scss \
         api/build/static/webapp/enketo.less --no-source-map

cd webapp && npm ci
npm run build -- --configuration=production
cd ..
```

**Check before deploying.** `index.html` must be roughly **850 bytes**. If
it is ~56 KB the production flag was missed and the app will hang on a
spinner.

```bash
stat -c%s api/build/static/webapp/index.html                    # expect ~851
grep -c getScaleDisplayFields api/build/static/webapp/main.js   # expect 1
```

```bash
# copy into the running api container
cd api/build/static/webapp
for f in main.js runtime.js polyfills.js scripts.js styles.css index.html; do
  docker cp $f <api-container>:/service/api/build/static/webapp/$f
done
docker restart <api-container>
```

> ⚠️ **This reverts silently.** `docker cp` writes to the container's
> writable layer. It survives `docker restart`, but **not**
> `docker compose up --force-recreate` — recreating the api container puts
> stock CHT back with no warning. Redeploy after any recreate.

### Step 2 — Upload the configuration

*Gives you: human question text instead of `report.ddst.g_lang.lang_18`,
and the hide-list that removes internal calculation fields.*

```bash
# from the satoruemr repo root
python scripts/gen_report_config.py

cht --url=https://medic:PASSWORD@<HOST>:10443 \
    --accept-self-signed-certs --force \
    upload-app-settings upload-app-forms \
    upload-contact-forms upload-custom-translations
```

- `--force` is not optional. Without it `cht-conf` prompts before
  overwriting and dies in any non-interactive shell.
- Re-run `gen_report_config.py` after **any** edit to `forms/app/*.xml` —
  it regenerates both the display config and the labels from the form XML.

### Step 3 — Hard-refresh the browser

CHT caches translations client-side. Skip this and a correct upload looks
like it did nothing.

`Ctrl` + `Shift` + `R` — or log out and back in.

---

## 3. Symptom → cause

| What you see | Cause | Fix |
|---|---|---|
| No Print button; UUIDs visible in reports | Stock bundle — webapp never built or deployed | Step 1 |
| `report.dst.g_child.assessment_date` as a label | Config / translations not uploaded | Step 2 |
| Same raw keys right after uploading | Browser cached the old translations | Step 3 |
| App stuck on a loading spinner forever | Built without `--configuration=production`, *or* running 5.2.0 images | §4 |
| Print output shows raw keys, screen is fine | Old `print-report.service.ts` using `field.label` directly | Already fixed in this repo |
| Everything reverted after a compose command | api container recreated, not restarted | Redeploy, Step 1 |
| `ng build` fails on `enketo.less` | The sass prerequisite was skipped | First command in Step 1 |
| `cht-conf` exits at "overwrite?" | No TTY | Add `--force` |
| `permission denied … docker.sock` | User not in the `docker` group | `sudo usermod -aG docker $USER`, re-login |
| Export sheet missing a scale | Nobody completed that scale in that camp | Expected — empty scales are skipped |

---

## 4. Two traps that cost days

### Run 5.3.0 images, never 5.2.0

The webapp calls `POST /api/v1/report/summary`. The published 5.2.0 API
has no such route — it returns 404 and the Reports view hangs on a spinner
forever. Every image in the stack must be `5.3.0`: `cht-api`,
`cht-sentinel`, `cht-nginx`, `cht-haproxy`, `cht-couchdb`,
`cht-couchdb-nouveau`.

### Build with `--configuration=production`

`webapp/angular.json` sets `defaultConfiguration: None`, so a bare
`ng build` inlines "critical CSS" into `index.html`. That inlined copy of
`.bootstrap-layer{display:flex}` is *unlayered*, so it overrides
`.bootstrapped .bootstrap-layer{display:none}`. The result is deceptive:
the app renders completely, then stays hidden behind a permanent loading
spinner. The production configuration sets `inlineCritical:false`.

The **851-byte `index.html`** check in Step 1 is the fastest way to prove
the flag took effect.

---

## 5. How the two repos connect

Neither half does anything alone. The platform holds the rendering code;
the config repo holds the forms, labels and the `report_display` block
that switches that code on.

| | Repo | What it is |
|---|---|---|
| **Engine** | [cht-core-satoru-reports](https://github.com/defaultname-ayan/cht-core-satoru-reports) | CHT 5.3.0 plus five patched files. Inert without config — a form with no `report_display` entry renders exactly as stock CHT, so the patch is safe for any other deployment. |
| **Fuel** | [satoruemr](https://github.com/donthireddysaivarshini/satoruemr/tree/feat/exports-and-deploy) `feat/exports-and-deploy` | The four scale forms, translations, generated settings, and the Python Excel exporters. `scale_meta.py` parses the form XML into labels and choice maps. |

Clone them as siblings — several scripts resolve each other by relative
path:

```
EMRCHT/
  cht-core/
  satoruemr/
```

Because labels for both the Reports screen and the Excel exports come from
the same form XML via `scale_meta.py`, the two can never disagree. Change
a question in `ddst.xml`, re-run `gen_report_config.py`, and both follow.

> **These two repos share no git history.** `git merge-base` between this
> cht-core and `donthireddysaivarshini/cht-core` returns nothing —
> rebasing conflicts across ~420 files and GitHub will not offer a pull
> request between them. Move changes with `git format-patch` / `git am`,
> or copy single files with `git checkout <ref> -- <path>`, which works
> fine across unrelated histories.

---

## 6. The five patched files

| File | What it does |
|---|---|
| `webapp/src/ts/services/format-data-record.service.ts` | Hides internal and calculation fields, resolves stored answers to the form's own labels (`P` → `Pass`), joins the chronological-age helpers into one readable row, attaches per-item scores, formats dates, drops empty rows. Entry point `getScaleDisplayFields()`, reached only when `settings.report_display[form]` exists. |
| `webapp/src/ts/services/print-report.service.ts` *(new)* | Renders those same rows into a print view and calls `window.print()`. Labels pass through `TranslateService` — without that the printout shows raw keys while the screen looks correct. |
| `webapp/src/ts/modules/reports/reports-content.component.ts` | `printReport(selection)` |
| `webapp/src/ts/modules/reports/reports-content.component.html` | The button itself |
| `webapp/src/css/inbox.less` | `.report-print-btn`, hidden in `@media print` |

Scoring is never recalculated anywhere — in the reports or the exports.
Stored form results are displayed exactly as the form computed them.

---

## 7. Excel exports

Separate from the report screen: Python, read-only against CouchDB, and
shipped as a container in the same Docker stack. No command line needed
day to day — it is a page at `https://<host>:10443/exports/`, on the same
host and port as CHT itself.

| Scope | Produces |
|---|---|
| `all-workbook` | Every participant across every camp. One sheet per scale plus a **Camp** column. No ID needed. |
| `camp-workbook=<campId>` | One camp: a Participants sheet, then one sheet per scale completed there — one row per assessment, human question columns, `<question> - score` columns. |
| `participant-report=<id>` | One participant, laid out as a report: assessment information, then each age band or domain, then scoring results and notes. |

Screeners are never listed as participants, and participants who did not
complete a scale never appear on its sheet. Details in
`satoruemr/scripts/EXPORTS.md`.

---

## 8. Verifying

Check the server, not the screen — faster and unambiguous.

```bash
# is the config live? expect ['ddst','dst','moca_assessment','vineland']
curl -sk "https://medic:PASS@<HOST>:10443/api/v1/settings" | python3 -c \
  "import sys,json;print(list(json.load(sys.stdin).get('report_display',{}).keys()))"

# are the labels live? expect ~810
curl -sk "https://medic:PASS@<HOST>:10443/medic/messages-en" | python3 -c \
  "import sys,json;d=json.load(sys.stdin);l={**(d.get('generic') or {}),**(d.get('custom') or {})};print(len([k for k in l if k.startswith('report.')]))"

# is the patched bundle actually being served? expect 1
curl -sk https://<HOST>:10443/main.js | grep -c getScaleDisplayFields
```

Offline, with no server at all, from the `satoruemr` repo:

```bash
python scripts/validate_exports.py      # 58 checks
node scripts/validate_report_patch.js   # 50 checks
```

> ⚠️ **Do not verify by clicking through the Reports list with browser
> automation.** Doing exactly that during this project deleted two report
> documents from CouchDB. Read the DOM or query the API instead.

---

Companion documents: [`AGENTS.md`](AGENTS.md) (written for AI coding
agents) and [`SATORU.md`](SATORU.md) in this repo; `SETUP.md` and
`scripts/EXPORTS.md` in satoruemr.
