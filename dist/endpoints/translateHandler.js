import { createLocalReq } from 'payload';
import { fieldAffectsData, fieldShouldBeLocalized, tabHasName } from 'payload/shared';
import { Translator } from 'deepl-node';
// Store DeepL API key globally (set by plugin)
let globalDeepLApiKey;
export function setGlobalDeepLApiKey(apiKey) {
    globalDeepLApiKey = apiKey;
}
/**
 * Payload accepts numeric ids as numbers; Mongo-style and UUID strings stay strings.
 * Only coerce plain digit strings (no leading zeros) to number.
 */ export function normalizeDocumentId(raw) {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return raw;
    }
    const s = String(raw).trim();
    if (/^\d+$/.test(s)) {
        const n = Number(s);
        if (Number.isSafeInteger(n) && String(n) === s) {
            return n;
        }
    }
    return s;
}
/**
 * Match one path segment against the current field list (tabs / unnamed rows recurse transparently).
 * Named tabs require the segment to equal the tab `name` before entering that tab's fields.
 */ function matchFieldStep(fields, segment, parentIsLocalized) {
    if (!fields?.length) {
        return null;
    }
    for (const field of fields){
        if (!field || field.type === 'ui') {
            continue;
        }
        if (field.type === 'tabs' && field.tabs) {
            for (const tab of field.tabs){
                if (tabHasName(tab) && tab.name) {
                    if (String(tab.name) === segment) {
                        return {
                            field: {
                                type: '__namedTab'
                            },
                            parentIsLocalizedForField: parentIsLocalized,
                            nextFields: tab.fields || [],
                            nextParentIsLocalized: parentIsLocalized
                        };
                    }
                    continue;
                }
                const inner = matchFieldStep(tab.fields, segment, parentIsLocalized);
                if (inner) {
                    return inner;
                }
            }
            continue;
        }
        if ((field.type === 'row' || field.type === 'collapsible') && !('name' in field && field.name)) {
            const inner = matchFieldStep(field.fields, segment, parentIsLocalized);
            if (inner) {
                return inner;
            }
            continue;
        }
        if (field.type === 'tab') {
            const inner = matchFieldStep(field.fields, segment, parentIsLocalized);
            if (inner) {
                return inner;
            }
            continue;
        }
        if (!fieldAffectsData(field)) {
            continue;
        }
        if (String(field.name) !== segment) {
            continue;
        }
        const loc = fieldShouldBeLocalized({
            field,
            parentIsLocalized
        });
        if (field.type === 'array' && field.fields?.length) {
            return {
                field,
                parentIsLocalizedForField: parentIsLocalized,
                nextFields: field.fields,
                nextParentIsLocalized: loc
            };
        }
        if (field.type === 'group' && field.fields?.length) {
            return {
                field,
                parentIsLocalizedForField: parentIsLocalized,
                nextFields: field.fields,
                nextParentIsLocalized: loc
            };
        }
        if (field.type === 'blocks' && field.blocks?.length) {
            const merged = field.blocks.flatMap((b)=>b.fields || []);
            return {
                field,
                parentIsLocalizedForField: parentIsLocalized,
                nextFields: merged,
                nextParentIsLocalized: loc
            };
        }
        if ((field.type === 'row' || field.type === 'collapsible') && field.fields?.length) {
            return {
                field,
                parentIsLocalizedForField: parentIsLocalized,
                nextFields: field.fields,
                nextParentIsLocalized: parentIsLocalized || loc
            };
        }
        return {
            field,
            parentIsLocalizedForField: parentIsLocalized,
            nextFields: [],
            nextParentIsLocalized: parentIsLocalized || loc
        };
    }
    return null;
}
/**
 * Map a translation job's document path to the Payload update path for localized data.
 * Document paths include numeric array indices ("0", "1"); schema definitions do not.
 * Walk both together so e.g. ['keyStats','0','name'] resolves to that full path when `name`
 * is localized inside a non-localized array, or to ['keyStats'] when the whole array is localized.
 */ function resolveLocalizedPatchRootForJobPath(jobPath, collectionFields) {
    if (!jobPath.length || !collectionFields?.length) {
        return null;
    }
    let fields = collectionFields;
    let parentIsLocalized = false;
    let docPath = [];
    let bestRoot = null;
    let i = 0;
    while(i < jobPath.length){
        const segment = jobPath[i];
        if (/^\d+$/.test(segment)) {
            if (docPath.length === 0) {
                return bestRoot;
            }
            docPath = [
                ...docPath,
                segment
            ];
            i++;
            continue;
        }
        const step = matchFieldStep(fields, segment, parentIsLocalized);
        if (!step) {
            break;
        }
        const { field } = step;
        const pll = step.parentIsLocalizedForField;
        if (field?.type === '__namedTab') {
            docPath = [
                ...docPath,
                segment
            ];
            fields = step.nextFields;
            parentIsLocalized = step.nextParentIsLocalized;
            i++;
            continue;
        }
        const loc = fieldShouldBeLocalized({
            field,
            parentIsLocalized: pll
        });
        docPath = [
            ...docPath,
            segment
        ];
        i++;
        if (loc) {
            bestRoot = [
                ...docPath
            ];
        }
        fields = step.nextFields;
        parentIsLocalized = step.nextParentIsLocalized;
    }
    return bestRoot;
}
function getAt(obj, path) {
    let cur = obj;
    for (const segment of path){
        if (cur == null) {
            return undefined;
        }
        cur = cur[segment];
    }
    return cur;
}
function setAt(target, path, value) {
    if (path.length === 0) {
        return;
    }
    let cur = target;
    for(let i = 0; i < path.length - 1; i++){
        const p = path[i];
        if (cur[p] == null || typeof cur[p] !== 'object') {
            cur[p] = {};
        }
        cur = cur[p];
    }
    cur[path[path.length - 1]] = value;
}
function deepClone(v) {
    return structuredClone(v);
}
function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
/** Remove timestamps / status from update payload; keep row `id` inside arrays. */ function stripReservedKeysFromPatch(value) {
    if (value === null || typeof value !== 'object') {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(stripReservedKeysFromPatch);
    }
    const next = {};
    for (const [k, v] of Object.entries(value)){
        if (k === 'createdAt' || k === 'updatedAt' || k === '_status') {
            continue;
        }
        next[k] = stripReservedKeysFromPatch(v);
    }
    return next;
}
function prepareRootPatch(patch) {
    const cleaned = stripReservedKeysFromPatch(deepClone(patch));
    delete cleaned.id;
    delete cleaned.collection;
    return cleaned;
}
export const translateHandler = async (req)=>{
    console.log('[Translate API] Request received');
    const { payload, user } = req;
    if (!user) {
        return Response.json({
            error: 'Unauthorized'
        }, {
            status: 401
        });
    }
    let body;
    try {
        body = await req.json();
    } catch  {
        return Response.json({
            error: 'Invalid JSON body'
        }, {
            status: 400
        });
    }
    const { docId, collection, fieldName, sourceLocale, targetLocale } = body || {};
    if (docId === undefined || docId === null || !collection || !fieldName || !sourceLocale || !targetLocale) {
        return Response.json({
            error: 'Missing required fields'
        }, {
            status: 400
        });
    }
    const normalizedId = normalizeDocumentId(docId);
    const collectionEntity = Object.values(payload.collections).find((c)=>c.config.slug === collection);
    if (!collectionEntity?.config?.fields) {
        return Response.json({
            error: `Unknown collection: ${collection}`
        }, {
            status: 400
        });
    }
    const pathKey = (p)=>p.map(String).join('\0');
    try {
        const payloadReq = await createLocalReq({
            user,
            locale: sourceLocale
        }, payload);
        const doc = await payload.findByID({
            collection: collection,
            id: normalizedId,
            locale: sourceLocale,
            depth: 10,
            req: payloadReq
        });
        const apiKey = globalDeepLApiKey || process.env.DEEPL_API_KEY;
        if (!apiKey) {
            return Response.json({
                error: 'DEEPL_API_KEY missing'
            }, {
                status: 500
            });
        }
        const translator = new Translator(apiKey);
        const deepLSource = mapDeepLSource(sourceLocale);
        const deepLTarget = mapDeepLTarget(targetLocale);
        const jobs = [];
        const registerForTranslation = (ref, key, text, documentPath)=>{
            if (!text || typeof text !== 'string' || !text.trim()) {
                return;
            }
            if (text.length === 24 && /^[0-9a-f]+$/.test(text)) {
                console.log(`[Translate API] Skipping ID: ${text.slice(0, 5)}...`);
                return;
            }
            const isUrlOrFile = /^(https?:\/\/|\/|www\.)/.test(text) || /\.(jpg|png|svg|webp|jpeg|pdf|css|js)$/i.test(text);
            if (isUrlOrFile) {
                console.log(`[Translate API] Skipping URL/File: ${text.slice(0, 20)}...`);
                return;
            }
            jobs.push({
                ref,
                key,
                text,
                documentPath
            });
        };
        const collectLexicalNodes = (node, documentPath)=>{
            if (!node || typeof node !== 'object') {
                return;
            }
            if (node.type === 'block' && node.fields && typeof node.fields === 'object') {
                collectFields(node.fields, documentPath);
                return;
            }
            if (node.type === 'text' && typeof node.text === 'string') {
                const originalText = node.text;
                const hasLeadingSpace = originalText.startsWith(' ');
                const hasTrailingSpace = originalText.endsWith(' ');
                node._originalLeadingSpace = hasLeadingSpace;
                node._originalTrailingSpace = hasTrailingSpace;
                const textToTranslate = originalText.trim();
                registerForTranslation(node, 'text', textToTranslate, documentPath);
            }
            if (node.children && Array.isArray(node.children)) {
                node.children.forEach((child)=>collectLexicalNodes(child, documentPath));
            }
        };
        const collectFields = (obj, pathPrefix)=>{
            if (!obj || typeof obj !== 'object') {
                return;
            }
            if (Array.isArray(obj)) {
                obj.forEach((item, i)=>collectFields(item, [
                        ...pathPrefix,
                        String(i)
                    ]));
                return;
            }
            for (const [key, value] of Object.entries(obj)){
                if (key.startsWith('_') || [
                    'createdAt',
                    'updatedAt',
                    'collection',
                    'filename',
                    'mimeType',
                    'filesize',
                    'width',
                    'height',
                    'url',
                    'id',
                    'blockType',
                    'slug'
                ].includes(key)) {
                    continue;
                }
                if (typeof value === 'string') {
                    registerForTranslation(obj, key, value, [
                        ...pathPrefix,
                        key
                    ]);
                } else if (typeof value === 'object' && value !== null && Array.isArray(value?.root?.children)) {
                    collectLexicalNodes(value.root, [
                        ...pathPrefix,
                        key
                    ]);
                } else if (typeof value === 'object') {
                    collectFields(value, [
                        ...pathPrefix,
                        key
                    ]);
                }
            }
        };
        const originalSnapshot = deepClone(doc);
        const dataToTranslate = deepClone(doc);
        console.log(`[Translate API] Translating ${collection} ${String(normalizedId)}...`);
        if (fieldName === 'all' || fieldName === 'content') {
            collectFields(dataToTranslate, []);
        } else {
            const val = dataToTranslate?.[fieldName];
            if (typeof val === 'string') {
                registerForTranslation(dataToTranslate, fieldName, val, [
                    fieldName
                ]);
            } else if (typeof val === 'object' && val !== null) {
                collectFields(val, [
                    fieldName
                ]);
            }
        }
        if (jobs.length > 0) {
            console.log(`[DeepL] Found ${jobs.length} strings to translate.`);
            let currentBatch = [];
            let currentBatchSize = 0;
            const MAX_BATCH_ITEMS = 50;
            const MAX_BATCH_CHARS = 30000;
            const processBatch = async (batch)=>{
                if (batch.length === 0) {
                    return;
                }
                try {
                    const texts = batch.map((j)=>j.text);
                    // @ts-expect-error DeepL batch typing
                    const results = await translator.translateText(texts, deepLSource, deepLTarget);
                    const resultsArray = Array.isArray(results) ? results : [
                        results
                    ];
                    batch.forEach((job, i)=>{
                        if (resultsArray[i]?.text) {
                            let translatedText = resultsArray[i].text;
                            if (job.key === 'text' && job.ref._originalLeadingSpace !== undefined) {
                                if (job.ref._originalLeadingSpace && !translatedText.startsWith(' ')) {
                                    translatedText = ' ' + translatedText;
                                }
                                if (job.ref._originalTrailingSpace && !translatedText.endsWith(' ')) {
                                    translatedText = translatedText + ' ';
                                }
                                delete job.ref._originalLeadingSpace;
                                delete job.ref._originalTrailingSpace;
                            }
                            job.ref[job.key] = translatedText;
                        }
                    });
                    console.log(`[DeepL] Successfully translated batch of ${batch.length} items.`);
                } catch (e) {
                    console.error(`[DeepL] BATCH FAILURE: ${e.message}`);
                }
            };
            for (const job of jobs){
                const textLen = job.text.length;
                if (currentBatch.length >= MAX_BATCH_ITEMS || currentBatchSize + textLen > MAX_BATCH_CHARS) {
                    await processBatch(currentBatch);
                    currentBatch = [];
                    currentBatchSize = 0;
                }
                currentBatch.push(job);
                currentBatchSize += textLen;
            }
            if (currentBatch.length > 0) {
                await processBatch(currentBatch);
            }
        } else {
            console.log('[DeepL] No translatable strings found (or all were filtered out).');
        }
        const patchRoots = new Set();
        for (const job of jobs){
            const root = resolveLocalizedPatchRootForJobPath(job.documentPath, collectionEntity.config.fields);
            if (root) {
                patchRoots.add(pathKey(root));
            } else {
                console.log(`[Translate API] Skipping patch for non-localized path: ${job.documentPath.join('.')}`);
            }
        }
        const patch = {};
        for (const key of patchRoots){
            const rootPath = key.split('\0');
            const nextVal = getAt(dataToTranslate, rootPath);
            const prevVal = getAt(originalSnapshot, rootPath);
            if (!deepEqual(nextVal, prevVal)) {
                setAt(patch, rootPath, deepClone(nextVal));
            }
        }
        const patchData = prepareRootPatch(patch);
        if (Object.keys(patchData).length === 0) {
            console.log('[Translate API] No localized fields to persist (nothing changed or nothing localized).');
            return Response.json({
                success: true,
                message: 'No localized changes to save.',
                skipped: true
            });
        }
        console.log('[Translate API] Patching localized roots:', [
            ...patchRoots
        ].map((k)=>k.split('\0').join('.')));
        const updateReq = await createLocalReq({
            user,
            locale: targetLocale
        }, payload);
        const updated = await payload.update({
            collection: collection,
            id: normalizedId,
            locale: targetLocale,
            data: patchData,
            depth: 0,
            req: updateReq,
            overrideAccess: true
        });
        console.log('[Translate API] Complete.');
        return Response.json({
            success: true,
            doc: updated
        });
    } catch (err) {
        console.error('[Translate API] CRITICAL ERROR:', err);
        return Response.json({
            error: err?.message || 'Translation failed',
            details: err?.data || err?.errors
        }, {
            status: 500
        });
    }
};
function mapDeepLSource(locale) {
    const lc = (locale || '').toLowerCase();
    if (lc.startsWith('en')) {
        return 'en';
    }
    if (lc.startsWith('ro')) {
        return 'ro';
    }
    if (lc.startsWith('de')) {
        return 'de';
    }
    return lc.slice(0, 2);
}
function mapDeepLTarget(locale) {
    const lc = (locale || '').toLowerCase();
    if (lc === 'en') {
        return 'en-GB';
    }
    if (lc.startsWith('ro')) {
        return 'ro';
    }
    if (lc.startsWith('de')) {
        return 'de';
    }
    return lc.slice(0, 2);
}

//# sourceMappingURL=translateHandler.js.map