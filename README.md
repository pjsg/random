# Random Machine

A configurable random generator that runs entirely in the browser. No build step, no server, no dependencies.

Live version [here](https://pjsg.github.io/random).

## Running

Open [index.html](index.html) in a browser. Alternatively, serve the folder:

```sh
python3 -m http.server 8000
```

## Features

- **Configurations** with a name and one or more fields, saved in the browser's localStorage.
- **Uniform numeric fields**: min, max and step (decimals are supported).
- **Distributions**: normal, binomial, Poisson, exponential, geometric and triangular (see below).
- **List fields**: a set of choices, e.g. Blue, Red, Green, Orange, optionally weighted (`2:Likely`, `1:Unlikely`).
- **Without-replacement groups** (uniform and list fields only): fields sharing the same "no-repeat group" label never repeat a combination. Weighted choices are honoured: each combination's weight is the product of its values' weights. Used combinations persist between browser sessions. When a group is exhausted it restarts automatically, and each group can be reset manually.
- **Import** a configuration from a URL, pasted JSON, or an `?import=<url>` link.
- **Export** a configuration as JSON.
- **Generate animation**: press and hold Generate (mouse, touch, or Space/Enter) and the output tiles spin; about a second after you release, they settle one by one. A quick tap gives a one-second spin. Reduced-motion preferences are respected.
- The last 50 results are kept per configuration.

## Configuration JSON

```json
{
  "name": "Dinner",
  "fields": [
    { "name": "Colour", "type": "list", "values": ["Blue", "Red", "Green", "Orange"], "group": "A" },
    { "name": "Number", "type": "number", "min": 1, "max": 6, "step": 1, "group": "A" },
    { "name": "Roll", "type": "number", "min": 1, "max": 100 }
  ]
}
```

| Property | Applies to | Notes |
| --- | --- | --- |
| `name` | config, field | Required for the config. |
| `type` | field | `"number"` (uniform), `"list"`, `"normal"`, `"binomial"`, `"poisson"`, `"exponential"`, `"geometric"` or `"triangular"`. Inferred from `values` if omitted. |
| `group` | number, list | Fields with the same label form one without-replacement group. |

Parameters by type:

| Type | Parameters | Output |
| --- | --- | --- |
| `number` | `min`, `max`, `step` (defaults 1, 100, 1) | Uniform over `min`, `min+step`, … ≤ `max` |
| `list` | `values`: array of strings, or a comma/newline-separated string; optional `markdown` (boolean) | One choice; `"w:Label"` gives it relative weight `w` (> 0, default 1) |
| `normal` | `mean` (0), `sd` (1, > 0), `decimals` (2) | Bell curve rounded to `decimals` places (0 for integers) |
| `binomial` | `trials` (10, 1–1000), `p` (0.5) | Number of successes in `trials` tries |
| `poisson` | `mean` (4, 0–1000) | Count of events, e.g. arrivals per interval |
| `exponential` | `mean` (1), `decimals` (2) | Waiting time between events |
| `geometric` | `p` (0.5, > 0) | Number of tries until the first success (1, 2, 3, …) |
| `triangular` | `min` (0), `mode` (5), `max` (10), `decimals` (2) | Between `min` and `max`, most likely near `mode` |

A weight prefix is a number then a colon at the start of a choice, so a plain choice like `12:30` would be read as weight 12 for the choice `30`. Write `1:12:30` to get the literal choice `12:30`.

### Markdown choices

Set `"markdown": true` on a list field (the "Render choices as Markdown" checkbox in the editor) to render each choice as Markdown. In this mode a string `values` is split on newlines only, so choices can contain commas. Supported:

- `**bold**`, `*italic*`, `~~strikethrough~~`, `` `code` ``, `# heading`
- `[links](https://example.com)` (http, https, mailto and tel only; opened in a new tab)
- A safe subset of HTML for things like colour: `<span style="color:red">Red</span>`. Allowed tags are `a b strong i em u s del code mark small sub sup span br img h1`–`h6`. Allowed style properties are `color`, `background-color`, `font-size`, `font-weight`, `font-style`, `font-family`, `text-decoration`, `text-transform`, `letter-spacing`, `width`, `height` and `vertical-align`. Everything else (scripts, event handlers, `url(...)`) is stripped, so imported configurations can't run code.
- Images: `![Hearts](https://example.com/hearts.svg)` or `<img src="…" alt="Hearts">`. The `src` may be an `https://` URL, an embedded `data:image/…` URI, or a relative path to a file served with the app (e.g. `images/hearts.svg`). Plain `http://` is refused. Images default to the height of the text; override with `<img … style="height:2em">`. Remote images are fetched without a referrer, but the image host can still see the viewer's IP, so only import configurations you trust. Relative images aren't available offline unless added to the cache list in [sw.js](sw.js).

- Pasting images: paste (or drag and drop) an image file into a list field's choices box and it is inserted as `![image](data:…)`. Raster images are shrunk to at most 256 px and kept under about 300 KB; SVG and GIF are embedded as-is. Pasting turns Markdown on for that field. Embedded images are stored in the configuration itself (browser storage is limited to a few MB in total), so prefer small images.

Weights still work: `3:<span style="color:green">Go</span>`.

Example weighted and distribution fields:

```json
{ "name": "Mood", "type": "list", "values": ["2:Likely", "1:Unlikely"] }
{ "name": "Height (cm)", "type": "normal", "mean": 170, "sd": 10, "decimals": 0 }
{ "name": "Heads in 10 flips", "type": "binomial", "trials": 10, "p": 0.5 }
```

A top-level `"groups": [["Colour", "Number"]]` (lists of field names) is also accepted as an alternative to per-field `group`.

An import may be a single config object or an array of them. Imports always get a fresh id.

### Importing from a URL

Paste a URL into the import box, or open `index.html?import=https://example.com/config.json`. The host must allow cross-origin requests (CORS).

## Installing on a phone (PWA)

Serve the app over HTTPS (GitHub Pages works), open it on the phone, then:

- **Android / Chrome**: menu → *Install app* (or *Add to Home screen*).
- **iOS / Safari**: Share → *Add to Home Screen*.

The app works offline once loaded. A service worker ([sw.js](sw.js)) caches the files; **bump `CACHE` in `sw.js` whenever you change any cached file** so installed copies update.

## Notes

- Editing and saving a configuration clears its remembered history, since the combination space may have changed.
- Data lives only in this browser's localStorage. Clearing site data removes configurations and group state.

## Files

- [index.html](index.html): page structure
- [style.css](style.css): styling and animations
- [app.js](app.js): storage, generation, editor and import/export
- [manifest.webmanifest](manifest.webmanifest), [sw.js](sw.js), [icons/](icons/): PWA install and offline support
- [images/](images/): suit icons used by the "Draw a card" example
