'use client'

import TranslateButton from './TranslateButton.js'

type TranslationFieldProps = {
  locales?: Array<{ label: string; value: string }>
}

export function TranslationField({ locales }: TranslationFieldProps) {
  return (
    <TranslateButton
      fieldToTranslate="all"
      locales={locales}
    />
  )
}

