// Prefix for client-side fetch calls — Next.js basePath is not applied automatically to fetch()
export const BASE_PATH = '/practiceiq';
export function api(path: string): string {
  return `${BASE_PATH}${path}`;
}
