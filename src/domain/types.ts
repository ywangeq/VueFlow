export type MediaKind = "audio" | "video";
export interface AssetVersion {
  id: string;
  kind: MediaKind;
  name: string;
  url: string;
  duration: number;
  createdAt: string;
  jobId?: string;
  textSnapshot: string;
  directionSnapshot?: string;
}
export interface ReviewComment {
  id: string;
  text: string;
  versionId: string | null;
  time: number;
  createdAt: string;
  resolved: boolean;
}
export interface GenerationJob {
  id: string;
  segmentId: string;
  kind: MediaKind;
  status: "awaiting_external" | "completed" | "cancelled";
  textSnapshot: string;
  directionSnapshot: string;
  baseVersionId: string | null;
  commentIds: string[];
  createdAt: string;
  completedVersionId?: string;
  baseApprovedSnapshot?: boolean;
  commentSnapshots?: {
    id: string;
    text: string;
    time: number;
    versionId: string | null;
    resolved?: boolean;
  }[];
}
export interface Segment {
  id: string;
  title: string;
  enabled: boolean;
  derivedFromId?: string;
  text: string;
  direction: string;
  gain: number;
  gap: number;
  approvedVersionIds: string[];
  activeAudioId: string | null;
  activeVideoId: string | null;
  versions: AssetVersion[];
  comments: ReviewComment[];
}
export interface Chapter {
  id: string;
  title: string;
  segments: Segment[];
}
export interface GraphConfig {
  layout: "chapter-segments";
  theme: "scifi";
  columnWidth: number;
  rowGap: number;
}
export interface Project {
  schemaVersion: 2;
  graph: GraphConfig;
  id: string;
  title: string;
  revision: number;
  masterGain: number;
  chapters: Chapter[];
  jobs: GenerationJob[];
  updatedAt: string;
}
export interface JobRequest {
  kind: MediaKind;
  commentIds?: string[];
}
export interface UploadOptions {
  kind: MediaKind;
  duration: number;
  jobId?: string;
}
