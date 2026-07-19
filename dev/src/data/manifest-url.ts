const manifestPath = 'data/firered/manifest.json';

export function gamePackManifestUrl(baseUrl: string): string {
  const leadingBase = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  const normalizedBase = leadingBase.endsWith('/') ? leadingBase : `${leadingBase}/`;
  return `${normalizedBase}${manifestPath}`;
}
