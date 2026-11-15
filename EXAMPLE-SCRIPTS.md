# Example weight scripts

These are scripts for the **Weight script** box of a list field (or its `weightScript` property in the JSON). Each script is the body of a function called with `items` (the choices) and `history` (earlier picks, most recent last), and must return one weight per item. See the README for the details.

## Avoid choices that share words with earlier picks

Good for things like book or film titles, where you want a change from what came up recently.

1. Strip noise words from every item and history entry, ignoring case and punctuation. Noise words are a fixed list (`the`, `a`, `an`, `of`, …) plus any word that appears in at least `5 + items.length / 5` of the items. For example, with 50 items, a word in 15 or more of them is noise. A word counts once per item however often it appears in it. With 6 or fewer items, no word can reach the limit.
2. Give every word a value, starting at 1.
3. For each history entry, multiply the value of each of its words by 0.0001.
4. An item with *n* words gets a weight equal to the product of its word values, raised to the power `1/n` (the geometric mean). An item made only of noise words gets weight 1.

So an item whose words have all been picked once gets weight 0.0001, whatever its length. An item that shares only some words with earlier picks gets a weight in between:

| Items | History | Weights |
| --- | --- | --- |
| `cat mat hat`, `dog sleep carpet` | none | 1, 1 |
| `cat mat hat`, `dog sleep carpet` | `cat mat hat` | 0.0001, 1 |
| `The Cat in the Hat`, `Green Eggs and Ham`, `The Cat Came Back` | `The Cat in the Hat` | 0.0001, 1, 0.0464 |

In the last row, `The Cat Came Back` shares one of its three words (`cat`) with the pick, so its weight is `0.0001 ** (1/3)`.

```js
const NOISE = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'is', 'it', 'as']);
const split = s => s.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);

// Words that appear in at least 5 + items.length / 5 of the items are noise too.
const itemCount = new Map(); // word -> number of items containing it
for (const item of items) {
  for (const w of new Set(split(item))) itemCount.set(w, (itemCount.get(w) || 0) + 1);
}
const limit = 5 + items.length / 5;
for (const [w, n] of itemCount) if (n >= limit) NOISE.add(w);

const words = s => split(s).filter(w => !NOISE.has(w));

const value = new Map(); // word -> value, default 1
const get = w => (value.has(w) ? value.get(w) : 1);

for (const entry of history) {
  const ws = words(entry);
  if (!ws.length) continue;
  for (const w of ws) value.set(w, get(w) * 0.0001);
}

return items.map(item => {
  const ws = words(item);
  if (!ws.length) return 1; // nothing but noise words
  return ws.reduce((p, w) => p * get(w), 1) ** (1 / ws.length);
});
```

### Version that works with long histories

Every pick multiplies some word values down. After about 80 picks containing the same word, its value drops below the smallest number JavaScript can hold and becomes 0. If every item reaches 0, the script returns all zeros, which the app rejects, so it falls back to the ordinary weights. This version does the same calculation with logarithms and scales the result so the largest weight is 1. The relative weights are the same, and the largest weight is always 1, so it never returns all zeros. (Items picked far more often than the others can still round down to 0, which just means they won't be picked.) (Because of the scaling, if every item has been picked once, this version returns 1 for each, while the version above returns 0.0001 for each. Only the ratios between weights matter.)

```js
const NOISE = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'is', 'it', 'as']);
const split = s => s.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter(Boolean);

// Words that appear in at least 5 + items.length / 5 of the items are noise too.
const itemCount = new Map(); // word -> number of items containing it
for (const item of items) {
  for (const w of new Set(split(item))) itemCount.set(w, (itemCount.get(w) || 0) + 1);
}
const limit = 5 + items.length / 5;
for (const [w, n] of itemCount) if (n >= limit) NOISE.add(w);

const words = s => split(s).filter(w => !NOISE.has(w));

// Same calculation as above, but each word's value is kept as a logarithm so that
// long histories can't make the numbers underflow to 0.
const logValue = new Map(); // word -> log(value), default log(1) = 0
const get = w => logValue.get(w) || 0;

for (const entry of history) {
  const ws = words(entry);
  if (!ws.length) continue;
  for (const w of ws) logValue.set(w, get(w) + Math.log(0.0001));
}

const logWeights = items.map(item => {
  const ws = words(item);
  return ws.length ? ws.reduce((s, w) => s + get(w), 0) / ws.length : 0;
});
const top = Math.max(...logWeights); // scale so the largest weight is 1
return logWeights.map(l => Math.exp(l - top));
```

To try it, paste this into **New → Import** as a complete configuration:

```json
{
  "name": "Book picker",
  "fields": [
    {
      "name": "Book",
      "type": "list",
      "values": [
        "The Cat in the Hat",
        "Green Eggs and Ham",
        "The Lorax",
        "Hop on Pop"
      ],
      "weightScript": "const NOISE = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'is', 'it', 'as']);\nconst split = s => s.toLowerCase().split(/[^\\p{L}\\p{N}']+/u).filter(Boolean);\n\n// Words that appear in at least 5 + items.length / 5 of the items are noise too.\nconst itemCount = new Map(); // word -> number of items containing it\nfor (const item of items) {\n  for (const w of new Set(split(item))) itemCount.set(w, (itemCount.get(w) || 0) + 1);\n}\nconst limit = 5 + items.length / 5;\nfor (const [w, n] of itemCount) if (n >= limit) NOISE.add(w);\n\nconst words = s => split(s).filter(w => !NOISE.has(w));\n\n// Same calculation as above, but each word's value is kept as a logarithm so that\n// long histories can't make the numbers underflow to 0.\nconst logValue = new Map(); // word -> log(value), default log(1) = 0\nconst get = w => logValue.get(w) || 0;\n\nfor (const entry of history) {\n  const ws = words(entry);\n  if (!ws.length) continue;\n  for (const w of ws) logValue.set(w, get(w) + Math.log(0.0001));\n}\n\nconst logWeights = items.map(item => {\n  const ws = words(item);\n  return ws.length ? ws.reduce((s, w) => s + get(w), 0) / ws.length : 0;\n});\nconst top = Math.max(...logWeights); // scale so the largest weight is 1\nreturn logWeights.map(l => Math.exp(l - top));"
    }
  ]
}
```
