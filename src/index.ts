import type { CollectionSlug, Config } from 'payload'

import { customEndpointHandler } from './endpoints/customEndpointHandler.js'
import { translateHandler, setGlobalDeepLApiKey } from './endpoints/translateHandler.js'

export type LocaleOption = {
  label: string
  value: string
}

export type TranslationPluginConfig = {
  /**
   * DeepL API key (required)
   */
  deepLApiKey: string
  /**
   * List of collections to enable translation for
   */
  collections?: Partial<Record<CollectionSlug, true>>
  /**
   * Available locales for translation (defaults to ro/en/de)
   */
  locales?: LocaleOption[]
  /**
   * Disable the plugin
   */
  disabled?: boolean
}

export const translationPlugin =
  (pluginOptions: TranslationPluginConfig) =>
  (config: Config): Config => {
    // Validate DeepL API key
    const deepLApiKey = pluginOptions.deepLApiKey || process.env.DEEPL_API_KEY
    if (!deepLApiKey) {
      throw new Error(
        'Translation Plugin: deepLApiKey is required. Please provide it in plugin options or set DEEPL_API_KEY environment variable.',
      )
    }

    // Default locales
    const defaultLocales: LocaleOption[] = [
      { label: 'Română', value: 'ro' },
      { label: 'English', value: 'en' },
      { label: 'Deutsch', value: 'de' },
    ]
    const locales = pluginOptions.locales || defaultLocales
    
    // Set global DeepL API key for the translate handler
    setGlobalDeepLApiKey(deepLApiKey)

    if (!config.collections) {
      config.collections = []
    }

    // Check if plugin-collection already exists before adding it
    const pluginCollectionExists = config.collections.some(
      (collection) => collection.slug === 'plugin-collection',
    )

    if (!pluginCollectionExists) {
      config.collections.push({
        slug: 'plugin-collection',
        fields: [
          {
            name: 'id',
            type: 'text',
          },
        ],
      })
    }

    // Add translation button to configured collections
    if (pluginOptions.collections) {
      for (const collectionSlug in pluginOptions.collections) {
        const collection = config.collections.find(
          (collection) => collection.slug === collectionSlug,
        )

        if (collection) {
          // Find the slug field and insert translation button after it
          const slugFieldIndex = collection.fields.findIndex(
            (field) => (field as any).name === 'slug',
          )

          const translationField = {
            name: 'translation-button',
            type: 'ui' as const,
            admin: {
              components: {
                Field: {
                  path: `translation-plugin/client#TranslationField`,
                  clientProps: {
                    locales: locales,
                  },
                },
              },
            },
          }

          if (slugFieldIndex !== -1) {
            // Insert after slug field
            collection.fields.splice(slugFieldIndex + 1, 0, translationField as any)
          } else {
            // If no slug field found, add at the beginning
            collection.fields.unshift(translationField as any)
          }
        }
      }
    }

    /**
     * If the plugin is disabled, we still want to keep added collections/fields so the database schema is consistent which is important for migrations.
     * If your plugin heavily modifies the database schema, you may want to remove this property.
     */
    if (pluginOptions.disabled) {
      return config
    }

    if (!config.endpoints) {
      config.endpoints = []
    }

    if (!config.admin) {
      config.admin = {}
    }

    if (!config.admin.components) {
      config.admin.components = {}
    }

    if (!config.admin.components.beforeDashboard) {
      config.admin.components.beforeDashboard = []
    }

    config.admin.components.beforeDashboard.push(
      `translation-plugin/client#BeforeDashboardClient`,
    )
    config.admin.components.beforeDashboard.push(
      `translation-plugin/rsc#BeforeDashboardServer`,
    )

    config.endpoints.push({
      handler: customEndpointHandler,
      method: 'get',
      path: '/my-plugin-endpoint',
    })

    // Register translation endpoint
    config.endpoints.push({
      handler: translateHandler,
      method: 'post',
      path: '/translate',
    })

    const incomingOnInit = config.onInit

    config.onInit = async (payload) => {
      // Ensure we are executing any existing onInit functions before running our own.
      if (incomingOnInit) {
        await incomingOnInit(payload)
      }

      const { totalDocs } = await payload.count({
        collection: 'plugin-collection',
        where: {
          id: {
            equals: 'seeded-by-plugin',
          },
        },
      })

      if (totalDocs === 0) {
        await payload.create({
          collection: 'plugin-collection',
          data: {
            id: 'seeded-by-plugin',
          },
        })
      }
    }

    return config
  }
