import {
  IdentificationResponse,
  Person,
  PersonDetail,
  SystemStats,
  IngestJob,
  HealthStatus,
} from '../types';

const API_BASE = '/api';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let errorDetail = `Request failed with status ${response.status}`;
    try {
      const errorJson = await response.json();
      if (errorJson.detail) {
        errorDetail = typeof errorJson.detail === 'string' 
          ? errorJson.detail 
          : JSON.stringify(errorJson.detail);
      }
    } catch {
      // ignore non-json error
    }
    throw new Error(errorDetail);
  }
  return response.json();
}

export const identifyFace = async (file: File): Promise<IdentificationResponse> => {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${API_BASE}/identify`, {
    method: 'POST',
    body: formData,
  });

  return handleResponse<IdentificationResponse>(response);
};

export const getPersons = async (params?: {
  skip?: number;
  limit?: number;
  search?: string;
  labeled_only?: boolean;
}): Promise<Person[]> => {
  const query = new URLSearchParams();
  if (params?.skip !== undefined) query.append('skip', params.skip.toString());
  if (params?.limit !== undefined) query.append('limit', params.limit.toString());
  if (params?.search) query.append('search', params.search);
  if (params?.labeled_only) query.append('labeled_only', 'true');

  const url = `${API_BASE}/persons${query.toString() ? `?${query.toString()}` : ''}`;
  const response = await fetch(url);
  return handleResponse<Person[]>(response);
};

export const getPerson = async (id: number): Promise<PersonDetail> => {
  const response = await fetch(`${API_BASE}/persons/${id}`);
  return handleResponse<PersonDetail>(response);
};

export const updatePersonLabel = async (id: number, label: string): Promise<Person> => {
  const response = await fetch(`${API_BASE}/persons/${id}/label`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ label }),
  });
  return handleResponse<Person>(response);
};

export const deletePerson = async (id: number): Promise<void> => {
  const response = await fetch(`${API_BASE}/persons/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete person (Status: ${response.status})`);
  }
};

export const getStats = async (): Promise<SystemStats> => {
  const response = await fetch(`${API_BASE}/stats`);
  return handleResponse<SystemStats>(response);
};

export const uploadVideoForIngest = async (
  file: File,
  cameraId: string,
  recordedAt?: string
): Promise<IngestJob> => {
  const formData = new FormData();
  formData.append('video', file);
  formData.append('camera_id', cameraId);
  if (recordedAt) {
    formData.append('recorded_at', recordedAt);
  }

  const response = await fetch(`${API_BASE}/ingest`, {
    method: 'POST',
    body: formData,
  });
  return handleResponse<IngestJob>(response);
};

export const getIngestJobs = async (): Promise<IngestJob[]> => {
  const response = await fetch(`${API_BASE}/ingest/jobs`);
  return handleResponse<IngestJob[]>(response);
};

export const getJobStatus = async (jobId: string): Promise<IngestJob> => {
  const response = await fetch(`${API_BASE}/ingest/status/${jobId}`);
  return handleResponse<IngestJob>(response);
};

export const checkHealth = async (): Promise<HealthStatus> => {
  const response = await fetch(`${API_BASE}/health`);
  return handleResponse<HealthStatus>(response);
};
