import type { PayloadHandler } from 'payload'
import { createLocalReq } from 'payload'
import {
  fieldAffectsData,
  fieldShouldBeLocalized,
  tabHasName,
} from 'payload/shared'
import { Translator } from 'deepl-node'

type TranslateBody = {
  docId: string | number
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

/**
 * Payload accepts numeric ids as numbers; Mongo-style and UUID strings stay strings.
 * Only coerce plain digit strings (no leading zeros) to number.
 */
export function normalizeDocumentId(raw: string | number): string | number {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return raw
  }
  const s = String(raw).trim()
  if (/^\d+$/.test(s)) {
    const n = Number(s)
    if (Number.isSafeInteger(n) && String(n) === s) {
      return n
    }
  }
  return s
}

type FieldMatchStep = {
  field: any
  /** parentIsLocalized for `fieldShouldBeLocalized` */
  parentIsLocalizedForField: boolean
  nextFields: any[]
  nextParentIsLocalized: boolean
}

/**
 * Match one path segment against the current field list (tabs / unnamed rows recurse transparently).
 * Named tabs require the segment to equal the tab `name` before entering that tab's fields.
 */
function matchFieldStep(
  fields: any[] | undefined,
  segment: string,
  parentIsLocalized: boolean,
): FieldMatchStep | null {
  if (!fields?.length) {
    return null
  }

  for (const field of fields) {
    if (!field || field.type === 'ui') {
      continue
    }

    if (field.type === 'tabs' && field.tabs) {
      for (const tab of field.tabs) {
        if (tabHasName(tab) && tab.name) {
          if (String(tab.name) === segment) {
            return {
              field: { type: '__namedTab' },
              parentIsLocalizedForField: parentIsLocalized,
              nextFields: tab.fields || [],
              nextParentIsLocalized: parentIsLocalized,
            }
          }
          continue
        }
        const inner = matchFieldStep(tab.fields, segment, parentIsLocalized)
        if (inner) {
          return inner
        }
      }
      continue
    }

    if (
      (field.type === 'row' || field.type === 'collapsible') &&
      !('name' in field && field.name)
    ) {
      const inner = matchFieldStep(field.fields, segment, parentIsLocalized)
      if (inner) {
        return inner
      }
      continue
    }

    if (field.type === 'tab') {
      const inner = matchFieldStep(field.fields, segment, parentIsLocalized)
      if (inner) {
        return inner
      }
      continue
    }

    if (!fieldAffectsData(field)) {
      continue
    }

    if (String(field.name) !== segment) {
      continue
    }

    const loc = fieldShouldBeLocalized({ field, parentIsLocalized })

    if (field.type === 'array' && field.fields?.length) {
      return {
        field,
        parentIsLocalizedForField: parentIsLocalized,
        nextFields: field.fields,
        nextParentIsLocalized: loc,
      }
    }

    if (field.type === 'group' && field.fields?.length) {
      return {
        field,
        parentIsLocalizedForField: parentIsLocalized,
        nextFields: field.fields,
        nextParentIsLocalized: loc,
      }
    }

    if (field.type === 'blocks' && field.blocks?.length) {
      const merged = field.blocks.flatMap((b: any) => b.fields || [])
      return {
        field,
        parentIsLocalizedForField: parentIsLocalized,
        nextFields: merged,
        nextParentIsLocalized: loc,
      }
    }

    if (
      (field.type === 'row' || field.type === 'collapsible') &&
      field.fields?.length
    ) {
      return {
        field,
        parentIsLocalizedForField: parentIsLocalized,
        nextFields: field.fields,
        nextParentIsLocalized: parentIsLocalized || loc,
      }
    }

    return {
      field,
      parentIsLocalizedForField: parentIsLocalized,
      nextFields: [],
      nextParentIsLocalized: parentIsLocalized || loc,
    }
  }

  return null
}

/**
 * Map a translation job's document path to the Payload update path for localized data.
 * Document paths include numeric array indices ("0", "1"); schema definitions do not.
 * Walk both together so e.g. ['keyStats','0','name'] resolves to that full path when `name`
 * is localized inside a non-localized array, or to ['keyStats'] when the whole array is localized.
 */
function resolveLocalizedPatchRootForJobPath(
  jobPath: string[],
  collectionFields: any[] | undefined,
): string[] | null {
  if (!jobPath.length || !collectionFields?.length) {
    return null
  }

  let fields = collectionFields
  let parentIsLocalized = false
  let docPath: string[] = []
  let bestRoot: string[] | null = null
  let i = 0

  while (i < jobPath.length) {
    const segment = jobPath[i]

    if (/^\d+$/.test(segment)) {
      if (docPath.length === 0) {
        return bestRoot
      }
      docPath = [...docPath, segment]
      i++
      continue
    }

    const step = matchFieldStep(fields, segment, parentIsLocalized)
    if (!step) {
      break
    }

    const { field } = step
    const pll = step.parentIsLocalizedForField

    if (field?.type === '__namedTab') {
      docPath = [...docPath, segment]
      fields = step.nextFields
      parentIsLocalized = step.nextParentIsLocalized
      i++
      continue
    }

    const loc = fieldShouldBeLocalized({ field, parentIsLocalized: pll })
    docPath = [...docPath, segment]
    i++

    if (loc) {
      bestRoot = [...docPath]
    }

    fields = step.nextFields
    parentIsLocalized = step.nextParentIsLocalized
  }

  return bestRoot
}

function getAt(obj: any, path: string[]): any {
  let cur = obj
  for (const segment of path) {
    if (cur == null) {
      return undefined
    }
    cur = cur[segment]
  }
  return cur
}

type SchemaPathStep =
  | { kind: 'field'; segment: string; field: any }
  | { kind: 'arrayIndex'; index: number }

/**
 * Same walk as document paths in the resolver: schema has no array indices, documents use "0","1",…
 * Emits steps so patch writes can use [] + numeric indices instead of { "0": … }.
 */
function explainSchemaPathForPatch(
  rootPath: string[],
  collectionFields: any[] | undefined,
): SchemaPathStep[] | null {
  if (!rootPath.length || !collectionFields?.length) {
    return null
  }

  const steps: SchemaPathStep[] = []
  let fields = collectionFields
  let parentIsLocalized = false
  let i = 0

  while (i < rootPath.length) {
    const segment = rootPath[i]

    if (/^\d+$/.test(segment)) {
      const last = steps[steps.length - 1]
      const lastField = last?.kind === 'field' ? last.field : null
      const isRepeater =
        lastField?.type === 'array' || lastField?.type === 'blocks'
      if (!last || last.kind !== 'field' || !isRepeater) {
        return null
      }
      steps.push({ kind: 'arrayIndex', index: Number(segment) })
      i++
      continue
    }

    const step = matchFieldStep(fields, segment, parentIsLocalized)
    if (!step) {
      return null
    }

    const { field } = step

    if (field?.type === '__namedTab') {
      steps.push({ kind: 'field', segment, field })
      fields = step.nextFields
      parentIsLocalized = step.nextParentIsLocalized
      i++
      continue
    }

    steps.push({ kind: 'field', segment, field })
    fields = step.nextFields
    parentIsLocalized = step.nextParentIsLocalized
    i++
  }

  return steps
}

/**
 * Write `value` at the path described by `steps`, allocating [] for Payload array fields
 * and merging row `id` from `originalDoc` for array rows so updates stay stable.
 */
function mergeLocalizedValueIntoPatch(
  patch: Record<string, unknown>,
  originalDoc: any,
  steps: SchemaPathStep[],
  value: unknown,
): void {
  if (steps.length === 0) {
    return
  }

  let curPatch: any = patch
  let curOrig: any = originalDoc

  for (let depth = 0; depth < steps.length; depth++) {
    const step = steps[depth]
    const isLast = depth === steps.length - 1

    if (step.kind === 'arrayIndex') {
      if (!Array.isArray(curPatch)) {
        return
      }
      const idx = step.index
      while (curPatch.length <= idx) {
        curPatch.push({})
      }
      let row = curPatch[idx]
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        row = {}
        curPatch[idx] = row
      }
      const origRow = Array.isArray(curOrig) ? curOrig[idx] : undefined
      if (
        origRow &&
        typeof origRow === 'object' &&
        !Array.isArray(origRow) &&
        origRow.id !== undefined &&
        origRow.id !== null
      ) {
        row.id = origRow.id
      }
      if (isLast) {
        return
      }
      curPatch = row
      curOrig = origRow
      continue
    }

    if (step.kind !== 'field') {
      return
    }

    const key = step.segment
    const field = step.field

    if (field?.type === '__namedTab') {
      if (isLast) {
        return
      }
      if (!curPatch[key] || typeof curPatch[key] !== 'object' || Array.isArray(curPatch[key])) {
        curPatch[key] = {}
      }
      curPatch = curPatch[key]
      curOrig = curOrig?.[key]
      continue
    }

    if (isLast) {
      curPatch[key] = deepClone(value)
      return
    }

    const next = steps[depth + 1]

    if (next?.kind === 'arrayIndex') {
      if (field.type !== 'array' && field.type !== 'blocks') {
        return
      }
      if (!Array.isArray(curPatch[key])) {
        curPatch[key] = []
      }
      curPatch = curPatch[key]
      curOrig = curOrig?.[key]
      continue
    }

    if (!curPatch[key] || typeof curPatch[key] !== 'object' || Array.isArray(curPatch[key])) {
      curPatch[key] = {}
    }
    curPatch = curPatch[key]
    curOrig = curOrig?.[key]
  }
}

function logPatchArrayShapes(
  patchData: Record<string, unknown>,
  collectionFields: any[] | undefined,
): void {
  if (!collectionFields?.length) {
    return
  }
  for (const [topKey, val] of Object.entries(patchData)) {
    const step = matchFieldStep(collectionFields, topKey, false)
    const field = step?.field
    if (field?.type === 'array' || field?.type === 'blocks') {
      console.log(
        `[Translate API] patch array shape "${topKey}": Array.isArray=${Array.isArray(val)} (expected true)`,
      )
    }
  }
}

function deepClone<T>(v: T): T {
  return structuredClone(v)
}

function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Remove timestamps / status from update payload; keep row `id` inside arrays. */
function stripReservedKeysFromPatch(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(stripReservedKeysFromPatch)
  }
  const next: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (k === 'createdAt' || k === 'updatedAt' || k === '_status') {
      continue
    }
    next[k] = stripReservedKeysFromPatch(v)
  }
  return next
}

function prepareRootPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const cleaned = stripReservedKeysFromPatch(deepClone(patch)) as Record<string, unknown>
  delete cleaned.id
  delete cleaned.collection
  return cleaned
}

export const translateHandler: PayloadHandler = async (req) => {
  console.log('[Translate API] Request received')

  const { payload, user } = req

  if (!user) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: TranslateBody
  try {
    body = (await (req as any).json()) as TranslateBody
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { docId, collection, fieldName, sourceLocale, targetLocale } = body || {}

  if (docId === undefined || docId === null || !collection || !fieldName || !sourceLocale || !targetLocale) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const normalizedId = normalizeDocumentId(docId)

  const collectionEntity = Object.values(payload.collections).find(
    (c) => c.config.slug === collection,
  )
  if (!collectionEntity?.config?.fields) {
    return Response.json({ error: `Unknown collection: ${collection}` }, { status: 400 })
  }

  const pathKey = (p: string[]) => p.map(String).join('\0')

  try {
    const payloadReq = await createLocalReq({ user, locale: sourceLocale as any }, payload)
    const doc = await (payload as any).findByID({
      collection: collection as any,
      id: normalizedId,
      locale: sourceLocale,
      depth: 10,
      req: payloadReq,
    })

    const apiKey = globalDeepLApiKey || process.env.DEEPL_API_KEY
    if (!apiKey) {
      return Response.json({ error: 'DEEPL_API_KEY missing' }, { status: 500 })
    }

    const translator = new Translator(apiKey)
    const deepLSource = mapDeepLSource(sourceLocale)
    const deepLTarget = mapDeepLTarget(targetLocale)

    type TranslationJob = {
      ref: any
      key: string
      text: string
      /** Path from document root to this translatable unit (string field path or richText field root). */
      documentPath: string[]
    }

    const jobs: TranslationJob[] = []

    const registerForTranslation = (ref: any, key: string, text: any, documentPath: string[]) => {
      if (!text || typeof text !== 'string' || !text.trim()) {
        return
      }

      if (text.length === 24 && /^[0-9a-f]+$/.test(text)) {
        console.log(`[Translate API] Skipping ID: ${text.slice(0, 5)}...`)
        return
      }

      const isUrlOrFile =
        /^(https?:\/\/|\/|www\.)/.test(text) || /\.(jpg|png|svg|webp|jpeg|pdf|css|js)$/i.test(text)

      if (isUrlOrFile) {
        console.log(`[Translate API] Skipping URL/File: ${text.slice(0, 20)}...`)
        return
      }

      jobs.push({ ref, key, text, documentPath })
    }

    const collectLexicalNodes = (node: any, documentPath: string[]) => {
      if (!node || typeof node !== 'object') {
        return
      }

      if (node.type === 'block' && node.fields && typeof node.fields === 'object') {
        collectFields(node.fields, documentPath)
        return
      }

      if (node.type === 'text' && typeof node.text === 'string') {
        const originalText = node.text
        const hasLeadingSpace = originalText.startsWith(' ')
        const hasTrailingSpace = originalText.endsWith(' ')

        node._originalLeadingSpace = hasLeadingSpace
        node._originalTrailingSpace = hasTrailingSpace

        const textToTranslate = originalText.trim()
        registerForTranslation(node, 'text', textToTranslate, documentPath)
      }

      if (node.children && Array.isArray(node.children)) {
        node.children.forEach((child: any) => collectLexicalNodes(child, documentPath))
      }
    }

    const collectFields = (obj: any, pathPrefix: string[]) => {
      if (!obj || typeof obj !== 'object') {
        return
      }

      if (Array.isArray(obj)) {
        obj.forEach((item, i) => collectFields(item, [...pathPrefix, String(i)]))
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
          registerForTranslation(obj, key, value, [...pathPrefix, key])
        } else if (
          typeof value === 'object' &&
          value !== null &&
          Array.isArray((value as any)?.root?.children)
        ) {
          collectLexicalNodes((value as any).root, [...pathPrefix, key])
        } else if (typeof value === 'object') {
          collectFields(value, [...pathPrefix, key])
        }
      }
    }

    const originalSnapshot = deepClone(doc)
    const dataToTranslate = deepClone(doc)

    console.log(`[Translate API] Translating ${collection} ${String(normalizedId)}...`)

    if (fieldName === 'all' || fieldName === 'content') {
      collectFields(dataToTranslate, [])
    } else {
      const val = dataToTranslate?.[fieldName]
      if (typeof val === 'string') {
        registerForTranslation(dataToTranslate, fieldName, val, [fieldName])
      } else if (typeof val === 'object' && val !== null) {
        collectFields(val, [fieldName])
      }
    }

    if (jobs.length > 0) {
      console.log(`[DeepL] Found ${jobs.length} strings to translate.`)

      let currentBatch: TranslationJob[] = []
      let currentBatchSize = 0
      const MAX_BATCH_ITEMS = 50
      const MAX_BATCH_CHARS = 30000

      const processBatch = async (batch: TranslationJob[]) => {
        if (batch.length === 0) {
          return
        }
        try {
          const texts = batch.map((j) => j.text)
          // @ts-expect-error DeepL batch typing
          const results = await translator.translateText(texts, deepLSource, deepLTarget)
          const resultsArray = Array.isArray(results) ? results : [results]

          batch.forEach((job, i) => {
            if (resultsArray[i]?.text) {
              let translatedText = resultsArray[i].text

              if (job.key === 'text' && job.ref._originalLeadingSpace !== undefined) {
                if (job.ref._originalLeadingSpace && !translatedText.startsWith(' ')) {
                  translatedText = ' ' + translatedText
                }
                if (job.ref._originalTrailingSpace && !translatedText.endsWith(' ')) {
                  translatedText = translatedText + ' '
                }
                delete job.ref._originalLeadingSpace
                delete job.ref._originalTrailingSpace
              }

              job.ref[job.key] = translatedText
            }
          })
          console.log(`[DeepL] Successfully translated batch of ${batch.length} items.`)
        } catch (e: any) {
          console.error(`[DeepL] BATCH FAILURE: ${e.message}`)
        }
      }

      for (const job of jobs) {
        const textLen = job.text.length
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
      if (currentBatch.length > 0) {
        await processBatch(currentBatch)
      }
    } else {
      console.log('[DeepL] No translatable strings found (or all were filtered out).')
    }

    const patchRoots = new Set<string>()
    for (const job of jobs) {
      const root = resolveLocalizedPatchRootForJobPath(
        job.documentPath,
        collectionEntity.config.fields,
      )
      if (root) {
        patchRoots.add(pathKey(root))
      } else {
        console.log(
          `[Translate API] Skipping patch for non-localized path: ${job.documentPath.join('.')}`,
        )
      }
    }

    const patch: Record<string, unknown> = {}
    for (const key of patchRoots) {
      const rootPath = key.split('\0')
      const nextVal = getAt(dataToTranslate, rootPath)
      const prevVal = getAt(originalSnapshot, rootPath)
      if (!deepEqual(nextVal, prevVal)) {
        const steps = explainSchemaPathForPatch(rootPath, collectionEntity.config.fields)
        if (!steps?.length) {
          console.warn(
            `[Translate API] Could not map patch path to schema, skipping: ${rootPath.join('.')}`,
          )
          continue
        }
        mergeLocalizedValueIntoPatch(patch, originalSnapshot, steps, nextVal)
      }
    }

    const patchData = prepareRootPatch(patch)

    logPatchArrayShapes(patchData, collectionEntity.config.fields)

    if (Object.keys(patchData).length === 0) {
      console.log('[Translate API] No localized fields to persist (nothing changed or nothing localized).')
      return Response.json({
        success: true,
        message: 'No localized changes to save.',
        skipped: true,
      })
    }

    console.log(
      '[Translate API] Patching localized roots:',
      [...patchRoots].map((k) => k.split('\0').join('.')),
    )

    const updateReq = await createLocalReq({ user, locale: targetLocale as any }, payload)
    const updated = await (payload as any).update({
      collection: collection as any,
      id: normalizedId,
      locale: targetLocale as any,
      data: patchData,
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

function mapDeepLSource(locale: string): string | null {
  const lc = (locale || '').toLowerCase()
  if (lc.startsWith('en')) {
    return 'en'
  }
  if (lc.startsWith('ro')) {
    return 'ro'
  }
  if (lc.startsWith('de')) {
    return 'de'
  }
  if (lc.startsWith('hu')) {
    return 'hu'
  }
  return lc.slice(0, 2)
}

function mapDeepLTarget(locale: string): string {
  const lc = (locale || '').toLowerCase()
  if (lc === 'en') {
    return 'en-GB'
  }
  if (lc.startsWith('ro')) {
    return 'ro'
  }
  if (lc.startsWith('de')) {
    return 'de'
  }
  if (lc.startsWith('hu')) {
    return 'hu'
  }
  return lc.slice(0, 2)
}
