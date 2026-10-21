import type { TenantType } from '../types.js';

export type TenantSetupStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'READY'
  | 'BLOCKED'
  | 'LIVE'
  | 'SUSPENDED';

export interface TenantSetupRequirement {
  key: string;
  label: string;
  reason: string;
  status: 'INCOMPLETE' | 'PENDING_REVIEW' | 'COMPLETE' | 'BLOCKED';
  progress: number;
  missing: string[];
  ctaLabel: string;
  ctaRoute?: string;
  weight: number;
  required: boolean;
  available: boolean;
  complete: boolean;
}

export interface TenantSetupResponse {
  tenant: {
    id: string;
    name: string;
    legalName: string | null;
    type: TenantType;
    status: string;
  };
  setup: {
    status: TenantSetupStatus;
    readinessPercent: number;
    readyAt: string | null;
    liveAt: string | null;
  };
  requirements: TenantSetupRequirement[];
  summary: {
    total: number;
    completed: number;
    required: number;
    requiredCompleted: number;
    ready: boolean;
  };
  overallProgress: number;
  sections: Array<{
    key: string;
    title: string;
    progress: number;
    required: number;
    percent: number;
    items: TenantSetupRequirement[];
  }>;
}
