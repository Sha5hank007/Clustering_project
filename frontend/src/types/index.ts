export interface LoginResponse {
  token: string;
  user_id: number;
  email: string;
  role: string;
  tenant_id: number;
  shop_id: number | null;
}

export interface Person {
  id: number;
  label: string | null;
  sighting_count: number;
  first_seen: string | null;
  last_seen: string | null;
  latest_crop_url: string | null;
  embedding_count?: number;
}

export interface Sighting {
  id: number;
  camera_id: string;
  seen_at: string | null;
  quality_score: number | null;
  crop_url: string | null;
}

export interface IngestJob {
  job_id: string;
  original_name: string;
  camera_id: string;
  recorded_at: string | null;
  progress_percent: number;
  status: string;
  persons_found: number;
  sightings_added: number;
  created_at: string | null;
  fps?: number | null;
  total_frames?: number | null;
  processed_frame?: number | null;
  error?: string | null;
  shop_id?: number | null;
}

export interface Stream {
  stream_id: string;
  camera_id: string;
  name: string | null;
  url: string;
  status: string;
  started_at: string | null;
  stopped_at: string | null;
  persons_found: number;
  sightings_added: number;
  shop_name: string;
}

export interface Stats {
  total_persons: number;
  total_sightings: number;
  total_crops_on_disk: number;
  storage_used_mb: number;
  first_sighting: string | null;
  last_sighting: string | null;
  cameras: string[];
  active_streams: number;
  pending_jobs: number;
}

export interface Shop {
  id: number;
  name: string;
  address: string | null;
  user_count: number;
  person_count: number;
  job_count: number;
  active_streams: number;
}

export interface User {
  id: number;
  email: string;
  role: string;
  shop_id: number | null;
  shop_name: string | null;
}

export interface IdentifyResult {
  person_id: number;
  label: string | null;
  similarity: number;
  first_seen: string | null;
  last_seen: string | null;
  total_sightings: number;
  sightings: Sighting[];
}
