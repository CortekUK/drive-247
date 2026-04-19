export interface StoredObjectRef {
  /** The opaque S3 key — not a URL, never exposed to the browser. */
  key: string;
}

export interface UploadOptions {
  /**
   * Logical folder for this object. The StorageService prefixes the key
   * with `tenants/{tenantId}/{folder}/...` so cross-tenant leakage at the
   * path level is impossible even with a coding error.
   */
  folder: string;
  /** File mime type — stored as S3 Content-Type. */
  contentType: string;
  /** Optional file extension for the generated key (e.g. 'jpg'). */
  extension?: string;
  /**
   * Optional custom filename component. If omitted, a random UUID is used.
   * Filename is sanitized and lowercased.
   */
  filename?: string;
}
