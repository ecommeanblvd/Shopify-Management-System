// vitest mock: server-only is a Next.js guard that throws in non-RSC contexts.
// In test environments we no-op it so pure functions in server-only modules
// can be imported and unit-tested without a real Next.js runtime.
export {};
