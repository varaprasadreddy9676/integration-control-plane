import { getAuthToken } from '../utils/auth-storage';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1';

export interface LoginResponse {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: string;
    orgId?: number | null;
    isActive?: boolean;
  };
  impersonatedBy?: string | null;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || data?.message || 'Login failed');
  }
  return data;
}

export async function getMe(): Promise<LoginResponse> {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Missing auth token');
  }
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    }
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || data?.message || 'Failed to fetch profile');
  }
  return data;
}

export async function impersonate(orgId: number, role: 'ORG_ADMIN' | 'ORG_USER' = 'ORG_ADMIN') {
  const token = getAuthToken();
  if (!token) {
    throw new Error('Missing auth token');
  }
  const response = await fetch(`${API_BASE_URL}/auth/impersonate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ orgId, role })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error || data?.message || 'Impersonation failed');
  }
  return data as LoginResponse;
}
