'use client'

import { Button, FieldLabel, SelectInput, useConfig, useDocumentInfo } from '@payloadcms/ui'
import React, { useEffect, useMemo, useState } from 'react'

type Props = {
  fieldToTranslate: string
  locales?: Array<{ label: string; value: string }>
  sourceLocale?: string
  targetLocale?: string
}

const DEFAULT_LOCALES = [
  { label: 'Română', value: 'ro' },
  { label: 'English', value: 'en' },
  { label: 'Deutsch', value: 'de' },
  { label: 'Magyar', value: 'hu' },
]

/**
 * Parse document info from Payload admin URL path
 * URL format: /admin/collections/:collectionSlug/:id
 */
function getDocInfoFromPath(pathname: string): { collectionSlug?: string; id?: string } {
  const parts = pathname.split('/').filter(Boolean)
  const idx = parts.indexOf('collections')

  if (idx === -1) {
    return { id: undefined, collectionSlug: undefined }
  }

  const collectionSlug = parts[idx + 1]
  const idOrCreate = parts[idx + 2]

  // Return id only if it's not 'create' (which means we're editing an existing doc)
  const id = idOrCreate && idOrCreate !== 'create' ? idOrCreate : undefined

  return { id, collectionSlug }
}

export default function TranslateButton({
  fieldToTranslate,
  locales = DEFAULT_LOCALES,
  sourceLocale,
  targetLocale,
}: Props) {
  const docInfo = useDocumentInfo()
  const { id, collectionSlug, isEditing } = docInfo
  const configResult = useConfig()
  // Try both patterns: configResult?.config or configResult directly
  const config = configResult?.config || configResult

  // Get pathname from window.location (works in browser, no Next.js dependency)
  const [pathname, setPathname] = useState<string>(
    typeof window !== 'undefined' ? window.location.pathname : '',
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const updatePathname = () => {
      setPathname(window.location.pathname)
    }

    // Update on navigation (for SPA navigation)
    window.addEventListener('popstate', updatePathname)

    // Also check periodically in case of programmatic navigation
    const interval = setInterval(updatePathname, 500)

    return () => {
      window.removeEventListener('popstate', updatePathname)
      clearInterval(interval)
    }
  }, [])

  // Fallback to URL parsing if useDocumentInfo() returns undefined values
  const urlDerived = useMemo(() => getDocInfoFromPath(pathname), [pathname])

  // Use hook values if available, otherwise fall back to URL parsing
  const effectiveCollectionSlug = collectionSlug || urlDerived.collectionSlug
  const effectiveId = id || urlDerived.id

  const [status, setStatus] = useState<'error' | 'idle' | 'loading' | 'success'>('idle')
  const [message, setMessage] = useState<string>('')

  // Use first locale as default source, second as default target if not provided
  const defaultSource = sourceLocale || locales[0]?.value || 'ro'
  const defaultTarget = targetLocale || locales[1]?.value || locales[0]?.value || 'en'

  const [src, setSrc] = useState<string>(defaultSource)
  const [tgt, setTgt] = useState<string>(defaultTarget)

  const label = useMemo(() => {
    return `Translate ${fieldToTranslate}`
  }, [fieldToTranslate])

  // Debug logging (remove in production)
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log('[TranslateButton] Document info:', {
      id,
      effectiveCollectionSlug,
      effectiveId,
      isEditing,
      urlDerived,
    })
  }, [effectiveCollectionSlug, effectiveId, id, isEditing, urlDerived])

  const onTranslate = async () => {
    if (!effectiveId || !effectiveCollectionSlug) {
      setStatus('error')
      setMessage('Document must be saved before translation. Please save the document first.')
      return
    }

    setStatus('loading')
    setMessage('')
    try {
      // Use API route directly for custom endpoint requests.
      const apiRoute = config?.routes?.api || '/api'
      const translateUrl = `${apiRoute}/translate`

      const res = await fetch(translateUrl, {
        body: JSON.stringify({
          collection: String(effectiveCollectionSlug),
          docId: typeof effectiveId === 'number' ? effectiveId : String(effectiveId),
          fieldName: fieldToTranslate,
          sourceLocale: src,
          targetLocale: tgt,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })

      const responseData = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(responseData?.error || 'Translation failed')
        return
      }
      setStatus('success')
      setMessage('Translated successfully. Switch locale to review.')
    } catch (e) {
      const err = e as Error
      setStatus('error')
      setMessage(err?.message || 'Request failed')
    }
  }

  // Document is ready for translation if:
  // 1. We have a collection slug (from hook or URL)
  // 2. We have an ID (from hook or URL) - document has been saved
  // 3. We're in edit mode (isEditing is true) or URL indicates edit view
  const canTranslate = Boolean(
    effectiveCollectionSlug && effectiveId && (isEditing !== false || effectiveId !== undefined),
  )

  return (
    <div className="field-type" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FieldLabel label={label} />
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr 1fr' }}>
        <div>
          <FieldLabel label="From" />
          <SelectInput
            isClearable={false}
            name="translateFrom"
            onChange={(selected: unknown) => {
              let next: string = locales[0]?.value || ''
              if (Array.isArray(selected)) {
                const first = selected[0] as { value?: string } | undefined
                next = first?.value ?? (locales[0]?.value || '')
              } else if (selected && typeof selected === 'object') {
                next = (selected as { value?: string }).value ?? (locales[0]?.value || '')
              }
              setSrc(next)
            }}
            options={locales}
            path="translateFrom"
            value={src}
          />
        </div>
        <div>
          <FieldLabel label="To" />
          <SelectInput
            isClearable={false}
            name="translateTo"
            onChange={(selected: unknown) => {
              let next: string = locales[1]?.value || locales[0]?.value || ''
              if (Array.isArray(selected)) {
                const first = selected[0] as { value?: string } | undefined
                next = first?.value ?? (locales[1]?.value || locales[0]?.value || '')
              } else if (selected && typeof selected === 'object') {
                next = (selected as { value?: string }).value ?? (locales[1]?.value || locales[0]?.value || '')
              }
              setTgt(next)
            }}
            options={locales}
            path="translateTo"
            value={tgt}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button disabled={status === 'loading' || !canTranslate} onClick={onTranslate}>
          {status === 'loading' ? 'Translating…' : 'Translate'}
        </Button>
      </div>
      {!canTranslate ? (
        <span style={{ color: '#6b7280', fontSize: '0.875rem' }}>
          {!effectiveCollectionSlug
            ? 'Translation is only available when editing a document.'
            : !effectiveId
              ? 'Please save the document first to enable translation.'
              : 'Translation is not available in this context.'}
        </span>
      ) : null}
      {message ? (
        <span style={{ color: status === 'error' ? '#b91c1c' : '#047857' }}>{message}</span>
      ) : null}
    </div>
  )
}
