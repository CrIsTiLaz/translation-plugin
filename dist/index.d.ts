import type { CollectionSlug, Config } from 'payload';
export type LocaleOption = {
    label: string;
    value: string;
};
export type TranslationPluginConfig = {
    /**
     * DeepL API key (required)
     */
    deepLApiKey: string;
    /**
     * List of collections to enable translation for
     */
    collections?: Partial<Record<CollectionSlug, true>>;
    /**
     * Available locales for translation (defaults to ro/en/de)
     */
    locales?: LocaleOption[];
    /**
     * Disable the plugin
     */
    disabled?: boolean;
};
export declare const translationPlugin: (pluginOptions: TranslationPluginConfig) => (config: Config) => Config;
