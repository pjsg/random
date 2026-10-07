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
- **Numeric fields**: min, max and step (decimals are supported).
- **List fields**: a set of values, e.g. Blue, Red, Green, Orange.
- **Without-replacement groups**: fields sharing the same "no-repeat group" label never repeat a combination. Used combinations persist between browser sessions. When a group is exhausted it restarts automatically, and each group can be reset manually.
- **Import** a configuration from a URL, pasted JSON, or an `?import=<url>` link.
- **Export** a configuration as JSON.
- **Generate animation**: the output tiles flicker, then settle one by one within about a second. Reduced-motion preferences are respected.
- Space or Enter triggers Generate on the run screen. The last 50 results are kept per configuration.

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
| `type` | field | `"number"` or `"list"`. Inferred from `values` if omitted. |
| `min`, `max`, `step` | number | Defaults 1, 100, 1. `step` must be > 0. |
| `values` | list | Array of strings (or a comma/newline-separated string). |
| `group` | field | Fields with the same label form one without-replacement group. |

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
