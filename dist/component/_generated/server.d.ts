export declare const action: import("convex/server").ActionBuilder<any, "public">;
export declare const httpAction: (func: (ctx: import("convex/server").GenericActionCtx<import("convex/server").GenericDataModel>, request: Request) => Promise<Response>) => import("convex/server").PublicHttpAction;
export declare const internalAction: import("convex/server").ActionBuilder<any, "internal">;
export declare const internalMutation: import("convex/server").MutationBuilder<any, "internal">;
export declare const internalQuery: import("convex/server").QueryBuilder<any, "internal">;
export declare const mutation: import("convex/server").MutationBuilder<any, "public">;
export declare const query: import("convex/server").QueryBuilder<any, "public">;
//# sourceMappingURL=server.d.ts.map