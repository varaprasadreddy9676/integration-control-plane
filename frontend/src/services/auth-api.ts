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

async function handleResponse(response: Response, defaultErrorMessage: string) {
  let data;
  const contentType = response.headers.get('content-type');
  const text = await response.text();

  if (text && contentType?.includes('application/json')) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = text;
    }
  } else {
    data = text;
  }

  if (!response.ok) {
    if (typeof data === 'string') {
      throw new Error(`Server is unavailable. Please try again later. (${response.status})`);
    }
    throw new Error(data?.error || data?.message || defaultErrorMessage);
  }

  return data;
}

export async function login(email: string, password: string): Promise<LoginResponse> {
  const response = await fetch(`${API_BASE_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ email, password })
  });

  return handleResponse(response, 'Login failed');
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
  
  return handleResponse(response, 'Failed to fetch profile');
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
  
  return handleResponse(response, 'Impersonation failed') as Promise<LoginResponse>;
}
