export interface CompiledBuildInputs {
  productDesignContract: {
    schemaVersion: "nodekit.product-design-contract/v1";
    contractId: string;
    product: { targetUser: string; primaryJob: string; primaryArtifact: string };
    journey: string[];
    designIntent: { emotionalTarget: string[]; dominantSurface: string; dominantAction: string; density: "low" | "medium" | "high" };
    interfaceHypothesis: { artifactDominance: string; agentPlacement: string; reviewBoundary: string; mobileTopology: string };
    requiredDesktopSurfaces: string[];
    requiredMobileSurfaces: string[];
    avoid: string[];
    requiredStates: string[];
    protectedDecisions: {
      primaryUser: "nodekit";
      primaryJob: "nodekit";
      canonicalWorkflow: "nodekit";
      dataAuthority: "nodekit";
      permissionBoundaries: "nodekit";
      completionCriteria: "nodeproof";
      finalVerdict: "nodeproof";
    };
  };
  atlasQuery: { terms: string; supportedDomains: string[]; readOnly: boolean; fromWedge: string };
}

export function compileOpportunityToBuild(opportunity: unknown): CompiledBuildInputs;

export interface MaterializedBuildPacket extends CompiledBuildInputs {
  packetPath: string;
  atlasQueryPath: string;
}

export function materializeBuildPacket(options: {
  repoRoot: string;
  opportunity: unknown;
  packetName?: string;
}): Promise<MaterializedBuildPacket>;
