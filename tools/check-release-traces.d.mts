export interface ReleaseTraceEntry {
  value: string;
  relative: string;
}

export interface ReleaseManifestContent {
  files: string[];
  [key: string]: unknown;
}

export interface ReleaseManifest {
  file: string;
  content: ReleaseManifestContent;
  entries: ReleaseTraceEntry[];
}

export interface ReleaseManifests {
  buildId: string;
  traces: string[];
  manifests: ReleaseManifest[];
}

export interface ReleaseTraceCheck {
  status: "PASS";
  build_id: string;
  server_traces: number;
  unique_files_checked: number;
  private_runtime_files: 0;
}

export function isPrivateReleasePath(relative: string): boolean;
export function readReleaseManifests(projectRoot: string, buildDir?: string): ReleaseManifests;
export function checkReleaseTraces(projectRoot: string, buildDir?: string): ReleaseTraceCheck;
