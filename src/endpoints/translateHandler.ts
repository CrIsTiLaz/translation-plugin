import type { PayloadHandler } from 'payload'
import { createLocalReq } from 'payload'
import { Translator } from 'deepl-node'

type TranslateBody = {
  docId: string
  collection: string
  fieldName: string
  sourceLocale: string
  targetLocale: string
}

// Store DeepL API key globally (set by plugin)
let globalDeepLApiKey: string | undefined

export function setGlobalDeepLApiKey(apiKey: string) {
  globalDeepLApiKey = apiKey
}

export const translateHandler: PayloadHandler = async (req) => {
  console.log('[Translate API] Request received')

  const { payload, user } = req

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: TranslateBody
  try {
    // PayloadRequest extends Request, so we can use json() method
    body = (await (req as any).json()) as TranslateBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { docId, collection, fieldName, sourceLocale, targetLocale } = body || {}

  if (!docId || !collection || !fieldName || !sourceLocale || !targetLocale) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  try {
    const numericId = Number.parseInt(String(docId), 10)

    // 1. Fetch Source Document
    const payloadReq = await createLocalReq({ user, locale: sourceLocale as any }, payload)
    const doc = await (payload as any).findByID({
      collection: collection as any,
      id: numericId,
      locale: sourceLocale,
      depth: 10,
      req: payloadReq,
    })

    // 2. Setup DeepL
    const apiKey = globalDeepLApiKey || process.env.DEEPL_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'DEEPL_API_KEY missing' }, { status: 500 })
    }

    const translator = new Translator(apiKey)
    const deepLSource = mapDeepLSource(sourceLocale)
    const deepLTarget = mapDeepLTarget(targetLocale)

    // --- BATCHING SYSTEM ---
    type TranslationJob = {
      ref: any
      key: string
      text: string
    }

    const jobs: TranslationJob[] = []

    // Helper: Register a string for translation
    const registerForTranslation = (ref: any, key: string, text: any) => {
      if (!text || typeof text !== 'string' || !text.trim()) return

      // --- FILTER LOGIC ---

      // 1. Skip MongoDB IDs (24 hex chars)
      if (text.length === 24 && /^[0-9a-f]+$/.test(text)) {
        console.log(`[Translate API] Skipping ID: ${text.slice(0, 5)}...`)
        return
      }

      // 2. Skip likely URLs or File Paths (More specific regex)
      // Checks for strings starting with http, https, or containing common file extensions
      const isUrlOrFile =
        /^(https?:\/\/|\/|www\.)/.test(text) || /\.(jpg|png|svg|webp|jpeg|pdf|css|js)$/i.test(text)

      if (isUrlOrFile) {
        console.log(`[Translate API] Skipping URL/File: ${text.slice(0, 20)}...`)
        return
      }

      jobs.push({ ref, key, text })
    }

    // --- RECURSIVE COLLECTORS ---

    const collectLexicalNodes = (node: any, _parent?: any, _index?: number) => {
      if (!node || typeof node !== 'object') return

      if (node.type === 'block' && node.fields && typeof node.fields === 'object') {
        collectFields(node.fields)
        return
      }

      if (node.type === 'text' && typeof node.text === 'string') {
        // Store original spacing info on the node for post-processing
        const originalText = node.text
        const hasLeadingSpace = originalText.startsWith(' ')
        const hasTrailingSpace = originalText.endsWith(' ')

        // Store spacing info for later restoration
        node._originalLeadingSpace = hasLeadingSpace
        node._originalTrailingSpace = hasTrailingSpace

        // Trim spaces for translation (DeepL might normalize them)
        // We'll restore them after translation
        const textToTranslate = originalText.trim()

        registerForTranslation(node, 'text', textToTranslate)
      }

      if (node.children && Array.isArray(node.children)) {
        node.children.forEach((child: any, i: number) => collectLexicalNodes(child, node, i))
      }
    }

    const collectFields = (obj: any) => {
      if (!obj || typeof obj !== 'object') return

      if (Array.isArray(obj)) {
        obj.forEach((item) => collectFields(item))
        return
      }

      for (const [key, value] of Object.entries(obj)) {
        if (
          key.startsWith('_') ||
          [
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
            'slug',
          ].includes(key)
        ) {
          continue
        }

        if (typeof value === 'string') {
          registerForTranslation(obj, key, value)
        } else if (
          typeof value === 'object' &&
          value !== null &&
          Array.isArray((value as any)?.root?.children)
        ) {
          collectLexicalNodes((value as any).root, (value as any).root, undefined)
        } else if (typeof value === 'object') {
          collectFields(value)
        }
      }
    }

    // --- EXECUTION ---
    console.log(`[Translate API] Translating ${collection} ${docId}...`)
    const dataToTranslate = JSON.parse(JSON.stringify(doc))

    if (fieldName === 'all' || fieldName === 'content') {
      collectFields(dataToTranslate)
    } else {
      const val = dataToTranslate?.[fieldName]
      if (typeof val === 'string') {
        registerForTranslation(dataToTranslate, fieldName, val)
      } else if (typeof val === 'object') {
        collectFields(val)
      }
    }

    // 3. Process Batch
    if (jobs.length > 0) {
      console.log(`[DeepL] Found ${jobs.length} strings to translate.`)

      // --- SMART BATCHING ---
      // We batch by COUNT (max 50) AND SIZE (max 30KB) to avoid API errors

      let currentBatch: TranslationJob[] = []
      let currentBatchSize = 0
      const MAX_BATCH_ITEMS = 50
      const MAX_BATCH_CHARS = 30000

      // Function to process a single batch
      const processBatch = async (batch: TranslationJob[]) => {
        if (batch.length === 0) return
        try {
          const texts = batch.map((j) => j.text)
          // @ts-ignore
          const results = await translator.translateText(texts, deepLSource, deepLTarget)
          const resultsArray = Array.isArray(results) ? results : [results]

          batch.forEach((job, i) => {
            if (resultsArray[i]?.text) {
              let translatedText = resultsArray[i].text

              // Restore spaces for Lexical text nodes
              if (job.key === 'text' && job.ref._originalLeadingSpace !== undefined) {
                // Restore leading space if original had it
                if (job.ref._originalLeadingSpace && !translatedText.startsWith(' ')) {
                  translatedText = ' ' + translatedText
                }
                // Restore trailing space if original had it
                if (job.ref._originalTrailingSpace && !translatedText.endsWith(' ')) {
                  translatedText = translatedText + ' '
                }
                // Clean up the metadata
                delete job.ref._originalLeadingSpace
                delete job.ref._originalTrailingSpace
              }

              job.ref[job.key] = translatedText
            }
          })
          console.log(`[DeepL] Successfully translated batch of ${batch.length} items.`)
        } catch (e: any) {
          console.error(`[DeepL] BATCH FAILURE: ${e.message}`)
          // Optional: If a batch fails, we could try one-by-one here as a fallback
        }
      }

      // Loop to build batches
      for (const job of jobs) {
        const textLen = job.text.length

        // If adding this job exceeds limits, process current batch first
        if (
          currentBatch.length >= MAX_BATCH_ITEMS ||
          currentBatchSize + textLen > MAX_BATCH_CHARS
        ) {
          await processBatch(currentBatch)
          currentBatch = []
          currentBatchSize = 0
        }

        currentBatch.push(job)
        currentBatchSize += textLen
      }

      // Process remaining items
      if (currentBatch.length > 0) {
        await processBatch(currentBatch)
      }
    } else {
      console.log('[DeepL] No translatable strings found (or all were filtered out).')
    }

    // 4. Merge & Save
    let existingTargetDoc: any = null
    try {
      existingTargetDoc = await (payload as any).findByID({
        collection: collection as any,
        id: numericId,
        locale: targetLocale as any,
        depth: 0,
        req: await createLocalReq({ user, locale: targetLocale as any }, payload),
      })
    } catch (e) {
      /* ignore */
    }

    let finalData = existingTargetDoc ? { ...existingTargetDoc } : { ...dataToTranslate }

    // Deep merge helper
    const deepMerge = (target: any, source: any) => {
      Object.keys(source).forEach((key) => {
        const sourceValue = source[key]
        const targetValue = target[key]
        if (sourceValue == null) return
        if (Array.isArray(sourceValue)) {
          target[key] = sourceValue
          return
        }
        if (typeof sourceValue === 'object' && sourceValue !== null) {
          if (
            targetValue == null ||
            typeof targetValue !== 'object' ||
            Array.isArray(targetValue)
          ) {
            target[key] = sourceValue
          } else {
            deepMerge(targetValue, sourceValue)
          }
        } else {
          target[key] = sourceValue
        }
      })
      return target
    }

    deepMerge(finalData, dataToTranslate)

    delete finalData.id
    delete finalData.createdAt
    delete finalData.updatedAt
    delete finalData._status
    delete finalData.collection

    const convertRelationshipsToIds = (obj: any): any => {
      if (!obj || typeof obj !== 'object') return obj
      if (Array.isArray(obj)) return obj.map(convertRelationshipsToIds)

      const hasId = obj.id !== undefined
      const isMedia = hasId && (obj.filename || obj.mimeType || obj.url) && !obj.root
      const isRelation = hasId && (obj.collection || obj.relationTo)
      const isContentRow =
        obj.serviceName !== undefined ||
        obj.stepNumber !== undefined ||
        obj.label !== undefined ||
        obj.question !== undefined

      if ((isMedia || isRelation) && !isContentRow) return obj.id

      const result: Record<string, any> = {}
      for (const [key, value] of Object.entries(obj)) {
        if (key === 'root' || (value && typeof value === 'object' && (value as any)?.root)) {
          result[key] = value
        } else if (
          value &&
          typeof value === 'object' &&
          !Array.isArray((value as any)?.root?.children)
        ) {
          result[key] = convertRelationshipsToIds(value)
        } else if (Array.isArray(value)) {
          result[key] = value.map(convertRelationshipsToIds)
        } else {
          result[key] = value
        }
      }
      return result
    }

    finalData = convertRelationshipsToIds(finalData)

    console.log('[Translate API] Saving update...')

    const updateReq = await createLocalReq({ user, locale: targetLocale as any }, payload)
    const updated = await (payload as any).update({
      collection: collection as any,
      id: numericId,
      locale: targetLocale as any,
      data: finalData,
      depth: 0,
      req: updateReq,
      overrideAccess: true,
    })

    console.log('[Translate API] Complete.')
    return Response.json({ success: true, doc: updated })
  } catch (err: any) {
    console.error('[Translate API] CRITICAL ERROR:', err)
    return Response.json(
      { error: err?.message || 'Translation failed', details: err?.data || err?.errors },
      { status: 500 },
    )
  }
}

// Helpers
function mapDeepLSource(locale: string): string | null {
  const lc = (locale || '').toLowerCase()
  if (lc.startsWith('en')) return 'en'
  if (lc.startsWith('ro')) return 'ro'
  if (lc.startsWith('de')) return 'de'
  return lc.slice(0, 2)
}

function mapDeepLTarget(locale: string): string {
  const lc = (locale || '').toLowerCase()
  if (lc === 'en') return 'en-GB'
  if (lc.startsWith('ro')) return 'ro'
  if (lc.startsWith('de')) return 'de'
  return lc.slice(0, 2)
}

