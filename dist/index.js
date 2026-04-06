import { translateHandler, setGlobalDeepLApiKey } from './endpoints/translateHandler.js';
export const translationPlugin = (pluginOptions)=>(config)=>{
        console.log('[Translation Plugin] Plugin function called');
        console.log('[Translation Plugin] Options:', {
            collections: pluginOptions.collections,
            locales: pluginOptions.locales,
            disabled: pluginOptions.disabled
        });
        // Validate DeepL API key
        const deepLApiKey = pluginOptions.deepLApiKey || process.env.DEEPL_API_KEY;
        if (!deepLApiKey) {
            throw new Error('Translation Plugin: deepLApiKey is required. Please provide it in plugin options or set DEEPL_API_KEY environment variable.');
        }
        console.log('[Translation Plugin] DeepL API key validated');
        // Default locales
        const defaultLocales = [
            {
                label: 'Română',
                value: 'ro'
            },
            {
                label: 'English',
                value: 'en'
            },
            {
                label: 'Deutsch',
                value: 'de'
            }
        ];
        const locales = pluginOptions.locales || defaultLocales;
        console.log('[Translation Plugin] Using locales:', locales);
        // Set global DeepL API key for the translate handler
        setGlobalDeepLApiKey(deepLApiKey);
        if (!config.collections) {
            config.collections = [];
        }
        // Check if plugin-collection already exists before adding it
        const pluginCollectionExists = config.collections.some((collection)=>collection.slug === 'plugin-collection');
        if (!pluginCollectionExists) {
            config.collections.push({
                slug: 'plugin-collection',
                fields: [
                    {
                        name: 'id',
                        type: 'text'
                    }
                ]
            });
        }
        // Add translation button to configured collections
        console.log('[Translation Plugin] Checking collections configuration:', pluginOptions.collections);
        if (pluginOptions.collections) {
            console.log('[Translation Plugin] Processing collections:', Object.keys(pluginOptions.collections));
            for(const collectionSlug in pluginOptions.collections){
                console.log('[Translation Plugin] Processing collection:', collectionSlug);
                const collection = config.collections.find((collection)=>collection.slug === collectionSlug);
                if (collection) {
                    console.log('[Translation Plugin] Collection found:', collectionSlug, 'with', collection.fields?.length || 0, 'fields');
                    // Detailed field inspection logging
                    console.log('[Translation Plugin] Inspecting fields for', collectionSlug);
                    collection.fields.forEach((field, idx)=>{
                        const fieldInfo = {
                            index: idx,
                            type: typeof field,
                            isFunction: typeof field === 'function'
                        };
                        if (typeof field === 'function') {
                            try {
                                const resolved = field({});
                                fieldInfo.resolved = {
                                    name: resolved?.name,
                                    type: resolved?.type,
                                    fieldType: resolved?.type
                                };
                                console.log(`[Translation Plugin] Field ${idx} (function):`, fieldInfo);
                            } catch (e) {
                                fieldInfo.error = String(e);
                                console.log(`[Translation Plugin] Field ${idx} (function, error):`, fieldInfo);
                            }
                        } else if (field && typeof field === 'object') {
                            fieldInfo.name = field.name;
                            fieldInfo.type = field.type;
                            fieldInfo.fieldType = field.type;
                            console.log(`[Translation Plugin] Field ${idx} (object):`, fieldInfo);
                        } else {
                            console.log(`[Translation Plugin] Field ${idx} (unknown):`, fieldInfo);
                        }
                    });
                    // Find the slug field and insert translation button after it
                    // Handle both direct field objects and function results
                    const findSlugFieldIndex = (fields)=>{
                        for(let i = 0; i < fields.length; i++){
                            const field = fields[i];
                            // Handle function fields that return field config (like slugField())
                            if (typeof field === 'function') {
                                try {
                                    const resolvedField = field({});
                                    console.log(`[Translation Plugin] Resolved field ${i} (function):`, {
                                        name: resolvedField?.name,
                                        type: resolvedField?.type
                                    });
                                    if (resolvedField && resolvedField.name === 'slug') {
                                        console.log('[Translation Plugin] Found slug field (function) at index:', i);
                                        return i;
                                    }
                                } catch (e) {
                                    console.log(`[Translation Plugin] Failed to resolve field ${i} (function):`, e);
                                // If function fails, continue
                                }
                            }
                            // Handle direct field objects
                            if (field && typeof field === 'object') {
                                const fieldName = field.name;
                                const fieldType = field.type;
                                if (fieldName === 'slug') {
                                    console.log('[Translation Plugin] Found slug field (object) at index:', i, 'type:', fieldType);
                                    return i;
                                }
                            }
                        }
                        return -1;
                    };
                    const slugFieldIndex = findSlugFieldIndex(collection.fields);
                    console.log('[Translation Plugin] Slug field index for', collectionSlug, ':', slugFieldIndex);
                    const componentPath = `translation-plugin/client#TranslationField`;
                    console.log('[Translation Plugin] Component path:', componentPath);
                    const translationField = {
                        // Field names must be alphanumeric in Payload.
                        name: 'translationButton',
                        type: 'ui',
                        admin: {
                            position: 'sidebar',
                            components: {
                                Field: {
                                    path: componentPath,
                                    clientProps: {
                                        locales: locales
                                    }
                                }
                            }
                        }
                    };
                    console.log('[Translation Plugin] Translation field config:', JSON.stringify(translationField, null, 2));
                    // Helper function to find field index by name
                    const findFieldIndexByName = (fields, fieldName)=>{
                        for(let i = 0; i < fields.length; i++){
                            const field = fields[i];
                            if (typeof field === 'function') {
                                try {
                                    const resolved = field({});
                                    if (resolved?.name === fieldName) {
                                        return i;
                                    }
                                } catch  {
                                // Continue
                                }
                            } else if (field && typeof field === 'object' && field.name === fieldName) {
                                return i;
                            }
                        }
                        return -1;
                    };
                    if (slugFieldIndex !== -1) {
                        // Insert after slug field
                        collection.fields.splice(slugFieldIndex + 1, 0, translationField);
                        console.log('[Translation Plugin] Translation field inserted after slug at index', slugFieldIndex + 1, 'for', collectionSlug);
                    } else {
                        // If no slug field found, try to insert after 'title' field
                        const titleFieldIndex = findFieldIndexByName(collection.fields, 'title');
                        if (titleFieldIndex !== -1) {
                            collection.fields.splice(titleFieldIndex + 1, 0, translationField);
                            console.log('[Translation Plugin] Translation field inserted after title at index', titleFieldIndex + 1, 'for', collectionSlug);
                        } else {
                            // Fallback: add at the end
                            collection.fields.push(translationField);
                            console.log('[Translation Plugin] Translation field added at end (no slug or title found) for', collectionSlug);
                        }
                    }
                    console.log('[Translation Plugin] Collection', collectionSlug, 'now has', collection.fields.length, 'fields');
                } else {
                    console.log('[Translation Plugin] WARNING: Collection not found:', collectionSlug);
                }
            }
        } else {
            console.log('[Translation Plugin] WARNING: No collections configured in plugin options');
        }
        /**
     * If the plugin is disabled, we still want to keep added collections/fields so the database schema is consistent which is important for migrations.
     * If your plugin heavily modifies the database schema, you may want to remove this property.
     */ if (pluginOptions.disabled) {
            console.log('[Translation Plugin] Plugin is disabled, returning early');
            return config;
        }
        if (!config.endpoints) {
            config.endpoints = [];
        }
        // Register translation endpoint
        config.endpoints.push({
            handler: translateHandler,
            method: 'post',
            path: '/translate'
        });
        console.log('[Translation Plugin] Translation endpoint registered at /translate');
        const incomingOnInit = config.onInit;
        config.onInit = async (payload)=>{
            console.log('[Translation Plugin] onInit hook called');
            // Ensure we are executing any existing onInit functions before running our own.
            if (incomingOnInit) {
                await incomingOnInit(payload);
            }
            const { totalDocs } = await payload.count({
                collection: 'plugin-collection',
                where: {
                    id: {
                        equals: 'seeded-by-plugin'
                    }
                }
            });
            if (totalDocs === 0) {
                await payload.create({
                    collection: 'plugin-collection',
                    data: {
                        id: 'seeded-by-plugin'
                    }
                });
                console.log('[Translation Plugin] Plugin collection seeded');
            }
        };
        console.log('[Translation Plugin] Plugin setup complete');
        return config;
    };

//# sourceMappingURL=index.js.map