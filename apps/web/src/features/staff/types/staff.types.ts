export interface StaffMember {
  id: string;
  hospitalId: string | null;
  departmentId: string | null;
  branchId: string | null;
  reportsToId: string | null;
  staffNumber: string | null;
  firstName: string;
  middleName: string | null;
  lastName: string;
  email: string;
  phone: string | null;
  whatsappNumber: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  nationalId: string | null;
  nationality: string | null;
  physicalAddress: string | null;
  profilePhotoUrl: string | null;
  hasProfilePhoto: boolean;
  jobTitle: string | null;
  employmentType: 'FULL_TIME' | 'PART_TIME' | 'LOCUM' | 'CONTRACTOR' | 'VOLUNTEER';
  professionalCategory: StaffProfessionalCategory | null;
  licenseNumber: string | null;
  specialty: string | null;
  subSpecialty: string | null;
  licensingBody: string | null;
  licenseExpiresAt: string | null;
  qualifications: string | null;
  yearsExperience: number | null;
  languages: string[];
  consultationFee: string | number | null;
  telehealthEnabled: boolean;
  acceptsOnlineBookings: boolean;
  acceptsNewPatients: boolean;
  professionalBio: string | null;
  professionalLinks: string[];
  verificationStatus: string;
  invitationStatus: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  invitationExpiresAt: string | null;
  registrationStatus: string | null;
  status: 'INVITED' | 'ACTIVE' | 'SUSPENDED' | 'ON_LEAVE' | 'OFFBOARDED';
  joinedAt: string | null;
  createdAt: string;
  updatedAt: string;
  branch: { id: string; name: string; code: string } | null;
  reportsTo: { id: string; firstName: string; lastName: string } | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  passwordConfigured: boolean;
  assignments: StaffDepartmentAssignment[];
  shifts: StaffShift[];
}

export interface StaffDepartmentAssignment {
  id: string;
  role: string;
  accessLevel: string;
  isPrimaryDepartment?: boolean;
  canAccessDashboard?: boolean;
  startsAt?: string | null;
  endsAt?: string | null;
  status?: string;
  assignedById?: string;
  assignedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  branch?: { id: string; name: string; code: string } | null;
  department: {
    id: string;
    staffProfileId: string;
    name: string;
    code: string;
    type?: string | null;
    category?: string | null;
    requiresDepartmentPassword?: boolean;
  };
}

export interface StaffShift {
  id: string;
  departmentId: string;
  branchId: string | null;
  shiftName: string;
  startTime: string;
  endTime: string;
  breakStartTime?: string | null;
  breakEndTime?: string | null;
  daysOfWeek: string[] | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  department: { id: string; name: string; code: string };
  branch: { id: string; name: string; code: string } | null;
}

export interface StaffAccessAttempt {
  id: string;
  userId: string;
  departmentId: string | null;
  status: 'SUCCESS' | 'FAILED_PASSWORD' | 'FAILED_MFA' | 'LOCKED' | 'UNAUTHORIZED';
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  department: { id: string; name: string; code: string } | null;
  action?: string;
  resource?: string;
  branchId?: string | null;
}

export type StaffProfessionalCategory =
  | 'DOCTOR'
  | 'DENTIST'
  | 'NURSE'
  | 'MIDWIFE'
  | 'PHARMACIST'
  | 'LAB_SCIENTIST'
  | 'RADIOGRAPHER'
  | 'PHYSIOTHERAPIST'
  | 'NUTRITIONIST'
  | 'PSYCHOLOGIST'
  | 'OPTOMETRIST'
  | 'TECHNICIAN'
  | 'ADMIN'
  | 'RECEPTIONIST'
  | 'OTHER';

export interface StaffDocument {
  id: string;
  type: string;
  status: 'UPLOADED' | 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedById: string;
  reviewedById: string | null;
  reviewNotes: string | null;
  expiresAt: string | null;
  createdAt: string;
  uploadedBy?: { displayName: string };
  reviewedBy?: { displayName: string } | null;
}

export interface StaffTimeOff {
  id: string;
  staffProfileId: string;
  startsAt: string;
  endsAt: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reason: string | null;
  reviewNotes: string | null;
  reviewedById: string | null;
  createdAt: string;
  updatedAt: string;
  scheduleConflicts?: string[];
}

export type StaffTimeOffEntry = StaffTimeOff;
export type StaffAccessLog = StaffAccessAttempt;

export interface StaffMeResponse {
  profile: {
    id: string;
    staffNumber: string | null;
    firstName: string;
    lastName: string;
    email: string;
    jobTitle: string | null;
    status: string;
    tenant: { id: string; name: string };
  } | null;
  assignments: StaffDepartmentAssignment[];
}

export interface CreateStaffInput {
  staffNumber?: string | undefined;
  firstName: string;
  middleName?: string | undefined;
  lastName: string;
  email: string;
  phone: string;
  whatsappNumber?: string | undefined;
  gender?: string | undefined;
  dateOfBirth?: string | undefined;
  nationalId?: string | undefined;
  nationality?: string | undefined;
  physicalAddress?: string | undefined;
  departmentId: string;
  role: string;
  branchId: string;
  accessLevel?: 'VIEW' | 'OPERATE' | 'MANAGE' | 'ADMIN';
  canAccessDashboard?: boolean;
  assignmentStartsAt?: string | undefined;
  assignmentEndsAt?: string | undefined;
  additionalAssignments?: AssignStaffDepartmentInput[] | undefined;
  jobTitle: string;
  employmentType?: StaffMember['employmentType'];
  joinedAt?: string | undefined;
  reportsToId?: string | undefined;
  licenseNumber?: string | undefined;
  specialty?: string | undefined;
  subSpecialty?: string | undefined;
  licensingBody?: string | undefined;
  licenseExpiresAt?: string | undefined;
  qualifications?: string | undefined;
  professionalCategory: StaffProfessionalCategory;
  yearsExperience?: number | undefined;
  languages: string[];
  consultationFee?: number | undefined;
  telehealthEnabled?: boolean | undefined;
  acceptsOnlineBookings: boolean;
  acceptsNewPatients?: boolean | undefined;
  professionalBio: string;
  professionalLinks?: string[] | undefined;
  serviceIds: string[];
  shiftName: string;
  shiftStartTime: string;
  shiftEndTime: string;
  shiftDays: string[];
}

export interface CreateStaffResponse {
  id: string;
  staffNumber: string | null;
  firstName: string;
  lastName: string;
  email: string;
  status: string;
  createdAt: string;
  invitationStatus: 'VERIFICATION_EMAIL_SENT' | 'EMAIL_DELIVERY_FAILED';
}

export type UpdateStaffInput = Partial<Pick<
  CreateStaffInput,
  | 'firstName'
  | 'middleName'
  | 'lastName'
  | 'phone'
  | 'whatsappNumber'
  | 'gender'
  | 'dateOfBirth'
  | 'nationalId'
  | 'nationality'
  | 'physicalAddress'
  | 'jobTitle'
  | 'employmentType'
  | 'reportsToId'
  | 'professionalCategory'
  | 'licenseNumber'
  | 'specialty'
  | 'subSpecialty'
  | 'licensingBody'
  | 'licenseExpiresAt'
  | 'qualifications'
  | 'yearsExperience'
  | 'languages'
  | 'consultationFee'
  | 'telehealthEnabled'
  | 'acceptsOnlineBookings'
  | 'acceptsNewPatients'
  | 'professionalBio'
  | 'professionalLinks'
>>;

export interface AssignStaffDepartmentInput {
  departmentId: string;
  branchId?: string | undefined;
  role: string;
  accessLevel: 'VIEW' | 'OPERATE' | 'MANAGE' | 'ADMIN';
  isPrimaryDepartment?: boolean;
  canAccessDashboard?: boolean;
  startsAt?: string | undefined;
  endsAt?: string | undefined;
}

export interface CreateStaffShiftInput {
  departmentId: string;
  branchId?: string | undefined;
  shiftName: string;
  startTime: string;
  endTime: string;
  breakStartTime?: string | undefined;
  breakEndTime?: string | undefined;
  daysOfWeek: string[];
}
