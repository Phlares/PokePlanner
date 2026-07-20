/** Title-case a hyphenated slug for display (`giovanni-gym` → `Giovanni Gym`). */
export function titleCase(slug: string): string {
  return slug
    .split('-')
    .map((part) => (part.length === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join(' ');
}
