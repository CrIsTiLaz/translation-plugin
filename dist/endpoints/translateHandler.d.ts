import type { PayloadHandler } from 'payload';
export declare function setGlobalDeepLApiKey(apiKey: string): void;
/**
 * Payload accepts numeric ids as numbers; Mongo-style and UUID strings stay strings.
 * Only coerce plain digit strings (no leading zeros) to number.
 */
export declare function normalizeDocumentId(raw: string | number): string | number;
export declare const translateHandler: PayloadHandler;
