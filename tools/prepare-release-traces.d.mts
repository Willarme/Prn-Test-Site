export interface ReleaseTracePreparation {
  status: "PREPARED";
  manifests_checked: number;
  manifests_changed: number;
  private_path_references_removed: number;
}

export function prepareReleaseTraces(projectRoot: string, buildDir?: string): ReleaseTracePreparation;
