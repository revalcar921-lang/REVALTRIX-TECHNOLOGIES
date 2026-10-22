export interface BranchOrganization {
  id: string;
  name: string;
  code: string;
}

export interface BranchDepartment {
  id: string;
  name: string;
  code: string;
  status: string;
}

export interface BranchCounts {
  departments: number;
  memberships: number;
  services: number;
}

export interface Branch {
  id: string;
  name: string;
  code: string;
  address: string | null;
  town: string | null;
  county: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  contactPhone: string | null;
  contactEmail: string | null;
  openingTime: string | null;
  closingTime: string | null;
  operatingDays: string[];
  status: string;
  organizationId: string | null;
  organization?: BranchOrganization | null;
  departments?: BranchDepartment[];
  _count?: BranchCounts;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBranchInput {
  name: string;
  code: string;
  address?: string;
  town?: string;
  county?: string;
  postalCode?: string;
  latitude?: number;
  longitude?: number;
  contactPhone?: string;
  contactEmail?: string;
  openingTime?: string;
  closingTime?: string;
  operatingDays?: string[];
  organizationId?: string;
}

export interface UpdateBranchInput {
  name?: string;
  code?: string;
  address?: string | null;
  town?: string | null;
  county?: string | null;
  postalCode?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  contactPhone?: string | null;
  contactEmail?: string | null;
  openingTime?: string | null;
  closingTime?: string | null;
  operatingDays?: string[];
  organizationId?: string | null;
}
