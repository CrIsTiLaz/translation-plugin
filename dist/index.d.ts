import type { CollectionSlug, Config } from 'payload';
export type LocaleOption = {
    label: string;
    value: string;
};
/** Slugs only, or a map of slug → enabled (truthy = enabled). */
export type TranslationPluginCollections = CollectionSlug[] | Partial<Record<CollectionSlug, true>>;
export type TranslationPluginConfig = {
    /**
     * DeepL API key (required)
     */
    deepLApiKey: string;
    /**
     * Collection slugs to enable: an array of slugs, or an object like `{ pages: true }`.
     * Only truthy entries count for the object form.
     */
    collections?: TranslationPluginCollections;
    /**
     * Available locales for translation (defaults to ro, en, de, hu)
     */
    locales?: LocaleOption[];
    /**
     * Disable the plugin
     */
    disabled?: boolean;
};
export declare const translationPlugin: (pluginOptions: TranslationPluginConfig) => (config: Config) => Config;
