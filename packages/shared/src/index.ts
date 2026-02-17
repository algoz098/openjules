export interface Mission {
  id?: string | number;
  name: string;
  description?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt?: string;
  updatedAt?: string;
}

export interface Job {
  id?: string | number;
  missionId: string | number;
  type: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  payload: Record<string, any>;
  result?: any;
  createdAt?: string;
  updatedAt?: string;
}

export interface Log {
  id?: string | number;
  jobId: string | number;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

export interface Setting {
  key: string;
  value: any;
  created_at?: string;
  updated_at?: string;
}
