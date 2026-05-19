export interface FeatureManifest {
  key: string;
  name: string;
  version: string;
  requiredScopes: string[];
  hasWriteOperations: boolean;
}

export interface Registry {
  get: (key: string) => FeatureManifest | undefined;
  list: () => FeatureManifest[];
}

export function createRegistry(manifests: FeatureManifest[]): Registry {
  const map = new Map<string, FeatureManifest>();
  for (const m of manifests) {
    if (map.has(m.key)) throw new Error(`Duplicate feature key: ${m.key}`);
    map.set(m.key, m);
  }
  return {
    get: (key) => map.get(key),
    list: () => [...map.values()],
  };
}
