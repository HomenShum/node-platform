import schema from "./component/schema.js";
export const modules = {
    "./_generated/api.js": () => import("./component/_generated/api.js"),
    "./_generated/server.js": () => import("./component/_generated/server.js"),
    "./caseflow.ts": () => import("./component/caseflow.js"),
};
/** Register NodeKit Caseflow in a convex-test host instance. */
export function register(testInstance, name = "nodekitCaseflow") {
    testInstance.registerComponent(name, schema, modules);
}
export default { modules, register, schema };
//# sourceMappingURL=convex-test.js.map