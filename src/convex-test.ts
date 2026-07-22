import type { GenericSchema, SchemaDefinition } from "convex/server";

import schema from "./component/schema.js";

export const modules: Record<string, () => Promise<unknown>> = {
  "./_generated/api.js": () => import("./component/_generated/api.js"),
  "./_generated/server.js": () => import("./component/_generated/server.js"),
  "./caseflow.ts": () => import("./component/caseflow.js"),
};

type ComponentTestRegistrar = {
  registerComponent(
    name: string,
    schema: SchemaDefinition<GenericSchema, boolean>,
    modules: Record<string, () => Promise<unknown>>,
  ): void;
};

/** Register NodeKit Caseflow in a convex-test host instance. */
export function register(
  testInstance: ComponentTestRegistrar,
  name = "nodekitCaseflow",
) {
  testInstance.registerComponent(name, schema, modules);
}

export default { modules, register, schema };
