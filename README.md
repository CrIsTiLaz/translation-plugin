# Payload Translation Plugin

A [Payload CMS](https://payloadcms.com) plugin that adds DeepL-powered translation to your collections. Translate content between locales directly in the admin panel.

## How to use this plugin

### 1. Install

Install from GitHub. From your Payload project folder:

```bash
# npm
npm install git+https://github.com/CrIsTiLaz/translation-plugin.git

# pnpm
pnpm add git+https://github.com/CrIsTiLaz/translation-plugin.git

# yarn
yarn add git+https://github.com/CrIsTiLaz/translation-plugin.git
```

You can pin a specific branch or tag by appending `#main` or `#v1.0.0` to the URL.

### 2. Configure

Register the plugin in your Payload config (e.g. `src/plugins/index.ts`) with the collections you want to enable:

```ts
import { translationPlugin } from 'translation-plugin'

export const plugins = [
  // ... other plugins
  translationPlugin({
    collections: {
      pages: true,
      posts: true,
      services: true,
    },
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

