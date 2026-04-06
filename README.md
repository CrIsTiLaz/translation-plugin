# Payload Translation Plugin

A [Payload CMS](https://payloadcms.com) plugin that adds DeepL-powered translation to your collections. Translate content between locales directly in the admin panel.

## How to use this plugin

### 1. Install

This package is published as **prebuilt JavaScript** under `dist/`, committed to the repo so installs from GitHub include runnable entry files. Your app should **not** need `transpilePackages` for this dependency.

**Payload:** `peerDependencies` require `payload@^3.37.0` (any Payload 3.x from 3.37 upward, including current 3.80.x lines, until 4.0).

#### Installation from GitHub

From your Payload + Next.js app root:

```bash
# npm (short GitHub specifier)
npm install translation-plugin@github:CrIsTiLaz/translation-plugin

# Or full git URL (optional branch/tag: #dev, #v1.0.0, etc.)
npm install git+https://github.com/CrIsTiLaz/translation-plugin.git#dev

# pnpm
pnpm add github:CrIsTiLaz/translation-plugin

# yarn
yarn add github:CrIsTiLaz/translation-plugin
```

**After install, confirm the package contains `dist` (not only `package.json` and `README.md`):**

```bash
ls node_modules/translation-plugin
# Expect: dist/  package.json  README.md

# Resolve the main entry (CommonJS resolver works for resolution; the package is ESM at runtime)
node -e "console.log(require.resolve('translation-plugin'))"
# Expect a path ending in .../node_modules/translation-plugin/dist/index.js
```

For pure ESM (Node 20+):

```bash
node --input-type=module -e "import { createRequire } from 'node:module'; const r = createRequire(import.meta.url); console.log(r.resolve('translation-plugin'));"
```

### 2. Configure

Register the plugin in your Payload config (e.g. `src/plugins/index.ts`) with the collections you want to enable:

```ts
import { translationPlugin } from 'translation-plugin'

export const plugins = [
  // ... other plugins
  translationPlugin({
    deepLApiKey: process.env.DEEPL_API_KEY!,
    // Either: array of collection slugs (must match `slug` in Payload exactly)
    collections: ['pages', 'posts', 'services'],
    // Or: map of slug → true (falsy entries are ignored)
    // collections: { pages: true, posts: true, services: true },
  }),
]
```

### 3. Environment

Set your DeepL API key in `.env`:

```
DEEPL_API_KEY=your_deepl_api_key_here
```

Get a key at [DeepL API](https://www.deepl.com/pro-api).

### 4. Run the app

```bash
pnpm install
pnpm dev
```

Then open the admin (e.g. [http://localhost:3000/admin](http://localhost:3000/admin)) and log in.

## Translation API behavior (`POST /api/translate`)

The admin **Translate** control calls `fieldName: "all"`, which walks the **current locale** document, sends translatable strings to DeepL, then updates **only localized fields** for the target locale. Non-localized fields (e.g. a shared `name` on a `team`-style collection) are **not** sent on that update, which avoids merging the full document and triggering validation errors on mixed localized / non-localized shapes.

**Supported well:** text, textarea, rich text (Lexical JSON), and localized **groups** and **arrays** (including row `id` values left intact—relationship rows are not flattened to bare ids). **Blocks** fields work when the whole field is localized; deeply nested block layouts with per-inner-field localization may need schema review.

**`fieldName: "all"`** can be heavy on large documents (many strings → many DeepL calls). Prefer a dedicated field name in the future if you add per-field translation in the UI.

Document ids: the API accepts numbers, numeric strings, or string ids (e.g. UUIDs); it only coerces plain digit strings to numbers when safe.

## Contributing / releasing

After changing `src/`, run `npm run build` and commit the updated `dist/` so GitHub installs stay usable. `prepublishOnly` runs the same build before `npm publish`.
