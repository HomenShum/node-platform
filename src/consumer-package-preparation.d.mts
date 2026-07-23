export declare const CONSUMER_PACKAGE_PROVENANCE_SCHEMA_VERSION: "nodekit.consumer-package-provenance/v1";

export declare class ConsumerPackagePreparationError extends Error {
  readonly code: string;
  constructor(code: string, message: string, options?: ErrorOptions);
}

export interface ConsumerPackagePreparationOptions {
  archivePath: string;
  candidateCommit: string;
  consumerRoot: string;
  expectedIntegrity: string;
  expectedName: string;
  expectedTarballSha256: string;
  expectedVersion: string;
  nodekitRoot: string;
  sourceHash: string;
  apply?: boolean;
  beforeApply?: () => void | Promise<void>;
  expectedConsumerCommit?: string;
  manifestPath?: string;
  packageJsonPath?: string;
  updateDependency?: boolean;
  vendorPath?: string;
}

export interface ConsumerPackageProvenance {
  schemaVersion: "nodekit.consumer-package-provenance/v1";
  classification: "package_preparation_only";
  checks: Record<string, true>;
  claims: {
    authenticatedAdoption: false;
    convexTestAuthenticatedAdoption: false;
    deploymentPerformed: false;
    threeConsumerGateSatisfied: false;
  };
  consumer: {
    baseCommit: string;
    packageJsonAfterSha256: string;
    packageJsonBeforeSha256: string;
    packageJsonPath: string;
  };
  dependency: {
    changed: boolean;
    name: string;
    previousSpecifier: string | null;
    requested: boolean;
    section: string | null;
    specifier: string;
  };
  nodekit: {
    candidateCommit: string;
    canonicalManifestSha256: string;
    fileCount: number;
    integrity: string;
    name: string;
    sourceHash: string;
    sourcePack: {
      canonicalManifestSha256: string;
      fileCount: number;
      unpackedSize: number;
    };
    tarballBytes: number;
    tarballSha256: string;
    unpackedSize: number;
    version: string;
  };
  vendor: {
    manifestPath: string;
    path: string;
  };
}

export interface ConsumerPackagePreparationResult {
  schemaVersion: "nodekit.consumer-package-preparation-result/v1";
  applied: boolean;
  authenticatedAdoption: false;
  deploymentPerformed: false;
  manifest: ConsumerPackageProvenance;
  manifestSha256: string;
  mode: "apply" | "dry-run";
  plannedWrites: string[];
}

export declare function canonicalConsumerProvenanceBytes(value: unknown): Uint8Array;

/**
 * Verify and optionally vendor one exact NodeKit package into a clean consumer
 * worktree. Dry-run is the default. This never deploys, commits, signs, or
 * claims authenticated adoption.
 */
export declare function prepareExactConsumerPackage(
  options: ConsumerPackagePreparationOptions,
): Promise<ConsumerPackagePreparationResult>;
