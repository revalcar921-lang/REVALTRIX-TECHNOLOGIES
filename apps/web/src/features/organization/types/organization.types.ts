import type { TenantType } from '../../dashboard/types.js';

export interface OrganizationResponse {
  tenant: {
    id: string;
    name: string;
    legalName: string | null;
    code: string;
    type: TenantType;
    status: string;
  };
  profile: {
    businessName: string | null;
    legalName: string | null;
    registrationNumber: string | null;
    taxIdentificationNumber: string | null;
    registrationCountry: string | null;
    businessType: string | null;
    incorporationDate: string | null;
    country: string;
    county: string | null;
    subcounty: string | null;
    city: string | null;
    address: string | null;
    latitude: string | number | null;
    longitude: string | number | null;
    postalCode: string | null;
    website: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    supportEmail: string | null;
    whatsappNumber: string | null;
    description: string | null;
    ownershipType: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
}

export interface UpdateOrganizationInput {
  businessName?: string;
  legalName?: string;
  registrationNumber?: string;
  taxIdentificationNumber?: string;
  registrationCountry?: string;
  businessType?: string;
  incorporationDate?: string;
  country?: string;
  county?: string;
  subcounty?: string;
  city?: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  postalCode?: string;
  website?: string;
  contactEmail?: string;
  contactPhone?: string;
  supportEmail?: string;
  whatsappNumber?: string;
  description?: string;
  ownershipType?: string;
}
