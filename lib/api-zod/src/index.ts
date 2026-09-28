export * from "./generated/api";
// Orval can legitimately generate a runtime Zod path-params schema and a
// query-parameter TypeScript type with the same public name. Keep DTOs under a
// type-only namespace so generated names can never collide with validators.
export type * as ApiTypes from "./generated/types";
