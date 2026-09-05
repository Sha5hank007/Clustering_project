export interface Sighting {
  id: number;
  seen_at: string;
  camera_id: string;
  quality_score?: number | null;
  crop_url?: string | null;
  bbox?: number[] | null;
}

export interface Person {
  id: number;
  label?: string | null;
  sighting_count: number;
  first_seen: string;
  last_seen: string;
  thumbnail_url?: string | null;
}

export interface PersonDetail {
  id: number;
  label?: string | null;
  embedding_count: number;
  sighting_count: number;
  first_seen: string;
  last_seen: string;
  model_version: string;
  sightings: Sighting[];
}

export interface IdentificationResponse {
  matched: boolean;
  person_id: number;
  label: string;
  similarity: number;
  first_seen: string;
  last_seen: string;
  total_sightings: number;
  sightings: Sighting[];
}

export interface RecentSightingItem {
  id: number;
  person_id: number;
  person_label?: string | null;
  camera_id: string;
  seen_at: string;
  crop_url?: string | null;
}

export interface SystemStats {
  total_persons: number;
  total_sightings: number;
  labeled_persons: number;
  sightings_last_24h: number;
  cameras_count: number;
  camera_breakdown: Record<string, number>;
  recent_sightings: RecentSightingItem[];
  model_detector: string;
  model_recognizer: string;
  match_threshold: number;
  query_threshold: number;
}

export interface IngestJob {
  job_id: string;
  filename: string;
  camera_id: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | string;
  progress: number;
  created_at: string;
  completed_at?: string | null;
  frames_processed: number;
  faces_detected: number;
  sightings_added: number;
  error?: string | null;
}

export interface HealthStatus {
  status: string;
  service: string;
  version: string;
  models: {
    detector: string;
    recognizer: string;
  };
  thresholds: {
    match: number;
    query: number;
  };
}
