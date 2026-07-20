const packDir = 'data/firered/';
const manifestPath = `${packDir}manifest.json`;

/** Normalize an app base URL to a leading-and-trailing-slashed prefix. */
function normalizeBase(baseUrl: string): string {
  const leadingBase = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  return leadingBase.endsWith('/') ? leadingBase : `${leadingBase}/`;
}

export function gamePackManifestUrl(baseUrl: string): string {
  return `${normalizeBase(baseUrl)}${manifestPath}`;
}

/**
 * Anchor a manifest-relative asset path under the static pack directory. Any attempt to
 * escape the base path (absolute or parent-directory paths) is rejected so the loader can
 * never issue a request outside the static base.
 */
export function fireRedAssetUrl(baseUrl: string, assetPath: string): string {
  if (assetPath.startsWith('/') || assetPath.split('/').includes('..')) {
    throw new Error(`Refusing to load pack asset outside the static base path: "${assetPath}"`);
  }
  return `${normalizeBase(baseUrl)}${packDir}${assetPath}`;
}
