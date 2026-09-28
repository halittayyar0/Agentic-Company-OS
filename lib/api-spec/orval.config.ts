import { defineConfig, InputTransformerFn } from "orval";
import path from "path";

const root = path.resolve(__dirname, "..", "..");
const apiClientReactSrc = path.resolve(root, "lib", "api-client-react", "src");
const apiZodSrc = path.resolve(root, "lib", "api-zod", "src");

// Our exports make assumptions about the title of the API being "Api" (i.e. generated output is `api.ts`).
const titleTransformer: InputTransformerFn = (config) => {
  config.info ??= {};
  config.info.title = "Api";

  return config;
};

export default defineConfig({
  "api-client-react": {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      workspace: apiClientReactSrc,
      target: "generated",
      client: "react-query",
      mode: "split",
      baseUrl: "/api",
      clean: true,
      prettier: true,
      override: {
        fetch: {
          includeHttpResponseReturnType: false,
        },
        mutator: {
          path: path.resolve(apiClientReactSrc, "custom-fetch.ts"),
          name: "customFetch",
        },
      },
    },
  },
  zod: {
    input: {
      target: "./openapi.yaml",
      override: {
        transformer: titleTransformer,
      },
    },
    output: {
      client: "zod",
      // Keep the generated tree self-contained. Giving Orval the package root
      // as a workspace makes it append schema re-exports to src/index.ts on
      // every run, which can collide with runtime Zod validator names. Absolute
      // output paths retain generated barrel files without mutating our curated
      // public package entrypoint.
      target: path.resolve(apiZodSrc, "generated"),
      schemas: {
        path: path.resolve(apiZodSrc, "generated", "types"),
        type: "typescript",
      },
      mode: "split",
      clean: true,
      prettier: true,
      override: {
        zod: {
          // The workspace intentionally ships Zod 3. Pin code generation to
          // its fluent validators (for example `z.string().uuid()`) instead
          // of relying on package auto-detection from the api-spec package.
          version: 3,
          coerce: {
            query: ["boolean", "number", "string"],
            param: ["boolean", "number", "string"],
            body: ["bigint", "date"],
            response: ["bigint", "date"],
          },
        },
        useDates: true,
        useBigInt: true,
      },
    },
  },
});
