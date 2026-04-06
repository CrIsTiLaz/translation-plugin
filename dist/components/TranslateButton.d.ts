import React from 'react';
type Props = {
    fieldToTranslate: string;
    locales?: Array<{
        label: string;
        value: string;
    }>;
    sourceLocale?: string;
    targetLocale?: string;
};
export default function TranslateButton({ fieldToTranslate, locales, sourceLocale, targetLocale, }: Props): React.JSX.Element;
export {};
