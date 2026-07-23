/* eslint-disable */
/** Generated function references for the NodeKit Caseflow component. */
import type * as caseflow from "../caseflow.js";
import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{ caseflow: typeof caseflow }>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
export declare const components: {};
