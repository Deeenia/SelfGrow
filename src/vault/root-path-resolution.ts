export function resolveSelfGrowRootPath(
  configuredRoot: string,
  rootFolders: readonly string[],
  isFolder: (path: string) => boolean,
  normalize: (path: string) => string,
): string {
  const configured = normalize(configuredRoot);
  if (isFolder(configured) || configured !== 'Raw') return configured;
  const candidates = rootFolders
    .map((folder) => normalize(`${folder}/Raw`))
    .filter((path) => isFolder(path));
  return candidates.length === 1 ? (candidates[0] ?? configured) : configured;
}
