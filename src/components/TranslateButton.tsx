'use client'

import React, { useMemo, useState } from 'react'
import { useDocumentInfo, useConfig, SelectInput, FieldLabel, Button } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'

type Props = {
  sourceLocale?: string
  targetLocale?: string
  fieldToTranslate: string
  locales?: Array<{ label: string; value: string }>
}

const DEFAULT_LOCALES = [
  { label: 'Română', value: 'ro' },
  { label: 'English', value: 'en' },
  { label: 'Deutsch', value: 'de' },
]

export default function TranslateButton({
  sourceLocale,
  targetLocale,
  fieldToTranslate,
  locales = DEFAULT_LOCALES,
}: Props) {
  const { id: docId, collectionSlug } = useDocumentInfo()
  const configResult = useConfig()
  // Try both patterns: configResult?.config or configResult directly
  const config = configResult?.config || configResult
  
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [message, setMessage] = useState<string>('')
  
  // Use first locale as default source, second as default target if not provided
  const defaultSource = sourceLocale || locales[0]?.value || 'ro'
  const defaultTarget = targetLocale || locales[1]?.value || locales[0]?.value || 'en'
  
  const [src, setSrc] = useState<string>(defaultSource)
  const [tgt, setTgt] = useState<string>(defaultTarget)

  const label = useMemo(() => {
    return `Translate ${fieldToTranslate}`
  }, [fieldToTranslate])

  const onTranslate = async () => {
    if (!docId || !collectionSlug) return
    
    setStatus('loading')
    setMessage('')
    try {
      // Use fallback URL if config is not available
      const apiRoute = config?.routes?.api || '/api'
      const translateUrl = formatAdminURL({
        adminRoute: apiRoute,
        path: '/translate',
      })
      
      const res = await fetch(translateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          docId: typeof docId === 'string' ? Number.parseInt(docId, 10) : (docId as number),
          collection: String(collectionSlug),
          fieldName: fieldToTranslate,
          sourceLocale: src,
          targetLocale: tgt,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        setStatus('error')
        setMessage(data?.error || 'Translation failed')
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

  // Only render if we're in a collection edit view (have docId and collectionSlug)
  // Return null on dashboard or other pages
  if (!docId || !collectionSlug) {
    return null
  }

  return (
    <div className="field-type" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <FieldLabel label={label} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <FieldLabel label="From" />
          <SelectInput
            path="translateFrom"
            name="translateFrom"
            options={locales as any}
            value={src}
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
            isClearable={false}
          />
        </div>
        <div>
          <FieldLabel label="To" />
          <SelectInput
            path="translateTo"
            name="translateTo"
            options={locales as any}
            value={tgt}
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
            isClearable={false}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={onTranslate} disabled={status === 'loading'}>
          {status === 'loading' ? 'Translating…' : 'Translate'}
        </Button>
      </div>
      {message ? (
        <span style={{ color: status === 'error' ? '#b91c1c' : '#047857' }}>{message}</span>
      ) : null}
    </div>
  )
}