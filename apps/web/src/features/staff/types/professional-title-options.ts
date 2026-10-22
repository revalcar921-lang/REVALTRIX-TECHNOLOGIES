import type { StaffProfessionalCategory } from './staff.types.js';

export const PROFESSIONAL_TITLE_OPTIONS = [
  { label: 'Dr.', jobTitle: 'Doctor', category: 'DOCTOR', providerType: 'PHYSICIAN' },
  { label: 'Dentist', jobTitle: 'Dentist', category: 'DENTIST', providerType: 'DENTIST' },
  { label: 'Nurse', jobTitle: 'Nurse', category: 'NURSE', providerType: 'NURSE' },
  { label: 'Midwife', jobTitle: 'Midwife', category: 'MIDWIFE', providerType: 'MIDWIFE' },
  { label: 'Pharmacist', jobTitle: 'Pharmacist', category: 'PHARMACIST', providerType: 'PHARMACIST' },
  { label: 'Lab Scientist', jobTitle: 'Laboratory Scientist', category: 'LAB_SCIENTIST', providerType: 'LABORATORY_SCIENTIST' },
  { label: 'Radiographer', jobTitle: 'Radiographer', category: 'RADIOGRAPHER', providerType: 'RADIOGRAPHER' },
  { label: 'Physiotherapist', jobTitle: 'Physiotherapist', category: 'PHYSIOTHERAPIST', providerType: 'PHYSIOTHERAPIST' },
  { label: 'Nutritionist', jobTitle: 'Nutritionist', category: 'NUTRITIONIST', providerType: 'NUTRITIONIST' },
  { label: 'Psychologist', jobTitle: 'Psychologist', category: 'PSYCHOLOGIST', providerType: 'PSYCHOLOGIST' },
  { label: 'Optometrist', jobTitle: 'Optometrist', category: 'OPTOMETRIST', providerType: 'OPTOMETRIST' },
  { label: 'Technician', jobTitle: 'Technician', category: 'TECHNICIAN', providerType: 'LABORATORY_TECHNICIAN' },
  { label: 'Administrator', jobTitle: 'Administrator', category: 'ADMIN', providerType: 'OTHER' },
  { label: 'Receptionist', jobTitle: 'Receptionist', category: 'RECEPTIONIST', providerType: 'OTHER' },
  { label: 'Other', jobTitle: 'Other', category: 'OTHER', providerType: 'OTHER' },
  { label: 'Clinical Officer', jobTitle: 'Clinical Officer', category: 'OTHER', providerType: 'CLINICAL_OFFICER' },
  { label: 'Laboratory Technician', jobTitle: 'Laboratory Technician', category: 'TECHNICIAN', providerType: 'LABORATORY_TECHNICIAN' },
  { label: 'Sonographer', jobTitle: 'Sonographer', category: 'TECHNICIAN', providerType: 'SONOGRAPHER' },
  { label: 'Occupational Therapist', jobTitle: 'Occupational Therapist', category: 'OTHER', providerType: 'OCCUPATIONAL_THERAPIST' },
  { label: 'Dietitian', jobTitle: 'Dietitian', category: 'NUTRITIONIST', providerType: 'DIETITIAN' },
  { label: 'Counsellor', jobTitle: 'Counsellor', category: 'PSYCHOLOGIST', providerType: 'COUNSELLOR' },
  { label: 'Anesthesiologist', jobTitle: 'Anesthesiologist', category: 'OTHER', providerType: 'ANESTHESIOLOGIST' },
  { label: 'Surgeon', jobTitle: 'Surgeon', category: 'OTHER', providerType: 'SURGEON' },
  { label: 'Optician', jobTitle: 'Optician', category: 'OTHER', providerType: 'OPTICIAN' },
  { label: 'Paramedic', jobTitle: 'Paramedic', category: 'OTHER', providerType: 'PARAMEDIC' },
  { label: 'Pharmacy Technician', jobTitle: 'Pharmacy Technician', category: 'TECHNICIAN', providerType: 'PHARMACY_TECHNICIAN' },
  { label: 'Clinical Specialist', jobTitle: 'Clinical Specialist', category: 'OTHER', providerType: 'SPECIALIST' },
] as const satisfies ReadonlyArray<{
  label: string;
  jobTitle: string;
  category: StaffProfessionalCategory;
  providerType: string;
}>;

export type ProviderType = (typeof PROFESSIONAL_TITLE_OPTIONS)[number]['providerType'];