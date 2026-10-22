import { FormEvent, useEffect, useState } from 'react';
import { getDepartments } from '../../departments/api/departments.api.js';
import { getBranches } from '../../branches/api/branches.api.js';
import { getOrganization } from '../../organization/api/organization.api.js';
import {
  assignStaffDepartment,
  createStaffShift,
  createStaffTimeOff,
  deleteStaffDocument,
  downloadStaffDocument,
  getStaffAccessHistory,
  getStaffDirectory,
  getStaffDocuments,
  getStaffTimeOff,
  offboardStaffMember,
  removeStaffDepartmentAssignment,
  approveStaffInvitation,
  resendStaffInvitation,
  requestStaffPasswordReset,
  removeStaffProfilePhoto,
  requestStaffContactVerification,
  verifyStaffContact,
  reviewStaffDocument,
  reviewStaffTimeOff,
  updateStaffMemberStatus,
  uploadStaffDocument,
} from '../api/staff.api.ts';
import { StaffAvatar } from './StaffAvatar.tsx';
import { StaffDialog } from './StaffDialog.tsx';
import { StaffProfileEditor } from './StaffProfileEditor.tsx';
import { StaffRegistrationForm } from './StaffRegistrationForm.tsx';
import type { Department } from '../../departments/types/department.types.js';
import type { Branch } from '../../branches/types/branch.types.js';
import type { OrganizationResponse } from '../../organization/types/organization.types.js';
import type {
  StaffAccessLog,
  StaffDocument,
  StaffMember,
  StaffTimeOffEntry,
} from '../types/staff.types.js';

interface StaffPageProps {
  onNavigate?: (path: string) => void;
}

const STAFF_TABS = [
  ['directory', 'Staff directory'],
  ['assignments', 'Department assignments'],
  ['roster', 'Shifts & roster'],
  ['documents', 'Verification & documents'],
  ['history', 'Access history'],
  ['analytics', 'Staff analytics'],
] as const;

export function StaffPage({ onNavigate }: StaffPageProps) {
  const [activeTab, setActiveTab] = useState<string>('directory');
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [organization, setOrganization] = useState<OrganizationResponse | null>(null);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [search, setSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [verificationFilter, setVerificationFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [accessFilter, setAccessFilter] = useState('');

  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [bulkDepartmentId, setBulkDepartmentId] = useState('');
  const [bulkRole, setBulkRole] = useState('Staff Member');

  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [timeOffDialogOpen, setTimeOffDialogOpen] = useState(false);
  const [shiftDialogOpen, setShiftDialogOpen] = useState(false);
  const [showShiftFor, setShowShiftFor] = useState<string | null>(null);
  const [editingStaffMember, setEditingStaffMember] = useState<StaffMember | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const [newDocumentType, setNewDocumentType] = useState<string>('PROFILE_PHOTO');
  const [verificationChallenge, setVerificationChallenge] = useState<{
    challengeId: string;
    channel: 'EMAIL' | 'PHONE';
    target: string;
    expiresAt: string;
  } | null>(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationSaving, setVerificationSaving] = useState(false);
  const [timeOff, setTimeOff] = useState<StaffTimeOffEntry[]>([]);
  const [timeOffForm, setTimeOffForm] = useState({ staffProfileId: '', startsAt: '', endsAt: '', reason: '' });
  const [accessHistory, setAccessHistory] = useState<StaffAccessLog[] | null>(null);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [rosterView, setRosterView] = useState<'DAY' | 'WEEK' | 'MONTH'>('WEEK');

  const [actionFor, setActionFor] = useState<string | null>(null);

  const [showAssignmentFor, setShowAssignmentFor] = useState<string | null>(null);
  const [assignment, setAssignment] = useState({
    departmentId: '',
    branchId: '',
    role: 'Staff Member',
    accessLevel: 'OPERATE',
    isPrimaryDepartment: false,
    canAccessDashboard: true,
  });

  const [shiftModalForm, setShiftModalForm] = useState({
    staffProfileId: '',
    departmentId: '',
    branchId: '',
    shiftName: 'Regular availability',
    startTime: '09:00',
    endTime: '17:00',
    daysOfWeek: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
  });

  async function loadData() {
    try {
      setLoading(true);
      setError(null);
      const [staffData, departmentData, branchData, orgData] = await Promise.all([
        getStaffDirectory(),
        getDepartments(),
        getBranches(),
        getOrganization(),
      ]);
      setStaff(staffData);
      setDepartments(departmentData);
      setBranches(branchData);
      setOrganization(orgData);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Unable to load staff directory.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const filteredStaff = staff.filter((member) => {
    const query = search.trim().toLowerCase();
    if (query) {
      const matchText = [
        member.firstName,
        member.lastName,
        member.email,
        member.phone,
        member.staffNumber,
        member.jobTitle,
        member.specialty,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!matchText.includes(query)) return false;
    }
    if (departmentFilter && !member.assignments.some((a) => a.department.id === departmentFilter)) {
      return false;
    }
    if (statusFilter && member.status !== statusFilter) return false;
    if (branchFilter && member.branchId !== branchFilter) return false;
    if (categoryFilter && member.professionalCategory !== categoryFilter) return false;
    if (verificationFilter && member.verificationStatus !== verificationFilter) return false;
    if (roleFilter && !member.assignments.some((a) => a.role === roleFilter)) return false;
    if (accessFilter && !member.assignments.some((a) => a.accessLevel === accessFilter)) return false;
    return true;
  });

  async function handleStaffCreated(id: string, note: string) {
    setAddDialogOpen(false);
    setMessage(`Staff member created successfully (${note}). ID: ${id}`);
    await loadData();
  }

  async function changeStatus(member: StaffMember) {
    const nextStatus = member.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
    const confirmed = window.confirm(
      `Change status for ${member.firstName} ${member.lastName} to ${nextStatus}?`,
    );
    if (!confirmed) return;

    try {
      setActionFor(member.id);
      setError(null);
      await updateStaffMemberStatus(member.id, {
        status: nextStatus,
        reason: `Administrative status change to ${nextStatus}`,
      });
      setMessage(`Staff member status updated to ${nextStatus}.`);
      await loadData();
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : 'Unable to update staff status.',
      );
    } finally {
      setActionFor(null);
    }
  }

  async function offboardStaff(member: StaffMember) {
    const reason = window.prompt(`Reason for offboarding ${member.firstName} ${member.lastName}:`);
    if (reason === null) return;

    try {
      setActionFor(member.id);
      setError(null);
      await offboardStaffMember(member.id, { reason: reason || 'Contract ended' });
      setMessage('Staff member offboarded and access revoked.');
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to offboard staff.');
    } finally {
      setActionFor(null);
    }
  }

  async function handleProgressInvitation(member: StaffMember) {
    try {
      setActionFor(member.id);
      setError(null);
      if (!member.emailVerified) {
        await resendStaffInvitation(member.id);
        setMessage('Verification email sent. The staff member must open it and verify their own address.');
      } else if (member.registrationStatus === 'ONBOARDING') {
        await requestStaffPasswordReset(member.id);
        setMessage('Password setup email sent.');
      } else {
        await approveStaffInvitation(member.id);
        setMessage('Staff member approved and setup email sent.');
      }
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to send invitation.');
    } finally {
      setActionFor(null);
    }
  }

  async function showDocuments(memberId: string) {
    setSelectedProfileId(memberId);
    setVerificationChallenge(null);
    setVerificationCode('');
    try {
      setError(null);
      const docs = await getStaffDocuments(memberId);
      setDocuments(docs);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load documents.');
    }
  }

  async function uploadDocumentForSelected(file?: File) {
    if (!file || !selectedProfileId) return;
    try {
      setSaving(true);
      setError(null);
      const document = await uploadStaffDocument(selectedProfileId, newDocumentType, file);
      setMessage(`Upload checks passed for ${document.fileName}. A reviewer must verify the document's identity and contents.`);
      await showDocuments(selectedProfileId);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Upload failed.');
    } finally {
      setSaving(false);
    }
  }

  async function reviewDocument(
    memberId: string,
    doc: StaffDocument,
    status: 'VERIFIED' | 'REJECTED',
  ) {
    const notes = window.prompt(`Review notes for ${doc.fileName}:`, status === 'VERIFIED' ? 'Verified valid credentials' : 'Document rejected');
    if (notes === null) return;

    try {
      setActionFor(doc.id);
      setError(null);
      await reviewStaffDocument(memberId, doc.id, status, notes);
      setMessage(`Document ${status.toLowerCase()} successfully.`);
      await showDocuments(memberId);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Document review failed.');
    } finally {
      setActionFor(null);
    }
  }

  async function requestContactCode(channel: 'EMAIL' | 'PHONE') {
    if (!selectedProfileId) return;
    setVerificationSaving(true);
    setError(null);
    setMessage(null);
    try {
      const challenge = await requestStaffContactVerification(selectedProfileId, channel);
      setVerificationChallenge(challenge);
      setVerificationCode('');
      setMessage(`Verification code sent to ${challenge.target}. It expires at ${new Date(challenge.expiresAt).toLocaleTimeString()}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to send verification code.');
    } finally {
      setVerificationSaving(false);
    }
  }

  async function submitContactCode() {
    if (!selectedProfileId || !verificationChallenge) return;
    setVerificationSaving(true);
    setError(null);
    setMessage(null);
    try {
      await verifyStaffContact(selectedProfileId, verificationChallenge.challengeId, verificationCode);
      setVerificationChallenge(null);
      setVerificationCode('');
      setMessage(`${verificationChallenge.channel === 'EMAIL' ? 'Email' : 'Phone'} verified successfully.`);
      await loadData();
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : 'Verification code was not accepted.');
    } finally {
      setVerificationSaving(false);
    }
  }

  async function deleteDocument(memberId: string, doc: StaffDocument) {
    if (!window.confirm(`Delete ${doc.fileName}?`)) return;
    try {
      setError(null);
      await deleteStaffDocument(memberId, doc.id);
      setMessage('Document deleted.');
      await showDocuments(memberId);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Delete failed.');
    }
  }

  async function downloadDocument(memberId: string, doc: StaffDocument) {
    try {
      setError(null);
      const blob = await downloadStaffDocument(memberId, doc.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Download failed.');
    }
  }

  async function removeSelectedPhoto() {
    if (!selectedProfileId) return;
    if (!window.confirm('Remove profile photo?')) return;
    try {
      setError(null);
      await removeStaffProfilePhoto(selectedProfileId);
      setMessage('Profile photo removed.');
      await showDocuments(selectedProfileId);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to remove photo.');
    }
  }

  async function showTimeOff(memberId: string) {
    setSelectedProfileId(memberId);
    if (!memberId) {
      setTimeOff([]);
      return;
    }
    try {
      setError(null);
      const list = await getStaffTimeOff(memberId);
      setTimeOff(list);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load time-off.');
    }
  }

  async function submitTimeOffModal(event: FormEvent) {
    event.preventDefault();
    if (!timeOffForm.staffProfileId) return;
    try {
      setSaving(true);
      setError(null);
      await createStaffTimeOff(timeOffForm.staffProfileId, {
        startsAt: new Date(timeOffForm.startsAt).toISOString(),
        endsAt: new Date(timeOffForm.endsAt).toISOString(),
        reason: timeOffForm.reason || undefined,
      });
      setMessage('Time-off request recorded successfully.');
      setTimeOffDialogOpen(false);
      setTimeOffForm({ staffProfileId: '', startsAt: '', endsAt: '', reason: '' });
      if (selectedProfileId) {
        await showTimeOff(selectedProfileId);
      }
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to record time-off.');
    } finally {
      setSaving(false);
    }
  }

  async function submitShiftModal(event: FormEvent) {
    event.preventDefault();
    if (!shiftModalForm.staffProfileId || !shiftModalForm.departmentId) return;
    try {
      setSaving(true);
      setError(null);
      await createStaffShift(shiftModalForm.staffProfileId, {
        departmentId: shiftModalForm.departmentId,
        branchId: shiftModalForm.branchId || undefined,
        shiftName: shiftModalForm.shiftName,
        startTime: shiftModalForm.startTime,
        endTime: shiftModalForm.endTime,
        daysOfWeek: shiftModalForm.daysOfWeek,
      });
      setMessage('New shift scheduled successfully.');
      setShiftDialogOpen(false);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to schedule shift.');
    } finally {
      setSaving(false);
    }
  }

  async function decideTimeOff(entry: StaffTimeOffEntry, status: 'APPROVED' | 'REJECTED') {
    if (!selectedProfileId) return;
    try {
      setError(null);
      await reviewStaffTimeOff(selectedProfileId, entry.id, status);
      setMessage(`Time-off request ${status.toLowerCase()}.`);
      await showTimeOff(selectedProfileId);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to update request.');
    }
  }

  async function showAccessHistory(member: StaffMember) {
    setHistoryFor(member.id);
    try {
      setError(null);
      const logs = await getStaffAccessHistory(member.id);
      setAccessHistory(logs);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load access history.');
    }
  }

  async function removeAssignment(member: StaffMember, assignmentId: string, isPrimary: boolean) {
    if (isPrimary && member.assignments.length === 1) {
      window.alert('Cannot remove the only primary department assignment. Assign a new primary department first.');
      return;
    }
    if (!window.confirm('Revoke department access for this staff member?')) return;
    try {
      setActionFor(member.id);
      setError(null);
      await removeStaffDepartmentAssignment(member.id, assignmentId);
      setMessage('Department access revoked.');
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to remove assignment.');
    } finally {
      setActionFor(null);
    }
  }

  async function runBulkAction(action: 'SUSPEND' | 'REACTIVATE' | 'ASSIGN' | 'REMOVE') {
    if (!selectedStaffIds.length) return;
    try {
      setSaving(true);
      setError(null);
      for (const id of selectedStaffIds) {
        if (action === 'SUSPEND') {
          await updateStaffMemberStatus(id, { status: 'SUSPENDED', reason: 'Bulk suspension' });
        } else if (action === 'REACTIVATE') {
          await updateStaffMemberStatus(id, { status: 'ACTIVE', reason: 'Bulk reactivation' });
        } else if (action === 'ASSIGN' && bulkDepartmentId) {
          await assignStaffDepartment(id, {
            departmentId: bulkDepartmentId,
            role: bulkRole || 'Staff Member',
            accessLevel: 'OPERATE',
            canAccessDashboard: true,
          });
        }
      }
      setMessage(`Bulk action (${action}) completed for ${selectedStaffIds.length} staff.`);
      setSelectedStaffIds([]);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Bulk action failed.');
    } finally {
      setSaving(false);
    }
  }

  function displayStatus(value?: string | null): string {
    if (!value) return '';
    return value
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/^\w/, (c) => c.toUpperCase());
  }

  function downloadCsv(list: StaffMember[]) {
    const headers = ['Staff Number', 'First Name', 'Last Name', 'Email', 'Phone', 'Job Title', 'Status', 'Professional Category'];
    const rows = list.map((m) => [
      m.staffNumber ?? '',
      m.firstName,
      m.lastName,
      m.email,
      m.phone ?? '',
      m.jobTitle ?? '',
      m.status,
      m.professionalCategory ?? '',
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.map((f) => `"${f}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `staff_directory_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const activeCount = staff.filter((m) => m.status === 'ACTIVE').length;
  const clinicianCount = staff.filter((m) => ['DOCTOR', 'CLINICIAN', 'NURSE', 'SPECIALIST'].includes(m.professionalCategory ?? '')).length;
  const verifiedClinicianCount = staff.filter((m) => m.verificationStatus === 'VERIFIED').length;
  const onDutyCount = staff.filter((m) => m.shifts.some((s) => s.status === 'ACTIVE')).length;
  const bookingClinicianCount = staff.filter((member) => member.acceptsOnlineBookings).length;
  const protectedDepartmentCount = departments.filter((d) => d.requiresDepartmentPassword).length;
  const suspendedCount = staff.filter((m) => ['SUSPENDED', 'OFFBOARDED'].includes(m.status)).length;
  const todayCode = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date().getDay()];

  if (loading) {
    return (
      <main className="registration-loading">
        <p>Loading staff management suite...</p>
      </main>
    );
  }

  return (
    <main className="branches-layout">
      <section className="dashboard-page-header staff-management-header">
        <div>
          <p className="dashboard-eyebrow">PEOPLE</p>
          <h1>Staff Management</h1>
          <p>
            Manage verified staff accounts, department and branch assignments, shift schedules, and
            department access history for <strong>{organization?.tenant.name ?? 'your organization'}</strong>.
          </p>
        </div>
        <div className="branches-form-actions">
          <button type="button" className="dashboard-primary-button" onClick={() => setAddDialogOpen(true)}>
            Add staff
          </button>
          <button
            type="button"
            className="dashboard-secondary-button"
            onClick={() => downloadCsv(filteredStaff)}
            disabled={!filteredStaff.length}
          >
            Export filtered staff
          </button>
          <button
            type="button"
            className="dashboard-secondary-button"
            onClick={() => onNavigate?.('/tenant/departments')}
          >
            Manage departments
          </button>
        </div>
      </section>

      {error && (
        <div className="registration-error" role="alert">
          {error}
        </div>
      )}
      {message && (
        <div className="form-success" role="status">
          {message}
        </div>
      )}

      <section className="staff-stat-grid" aria-label="Staff summary">
        {[
          ['Total staff', staff.length],
          ['Active staff', activeCount],
          ['Protected departments', protectedDepartmentCount],
          ['Doctors / clinicians', clinicianCount],
          ['Verified clinicians', verifiedClinicianCount],
          ['On duty today', onDutyCount],
          ['Accept online bookings', bookingClinicianCount],
          ['Suspended / offboarded', suspendedCount],
        ].map(([label, value]) => (
          <div key={label} className="staff-stat">
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <nav className="staff-tabs" aria-label="Staff management views" role="tablist">
        {STAFF_TABS.map(([id, label]) => (
          <button
            key={id}
            id={`staff-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`staff-panel-${id}`}
            className={activeTab === id ? 'is-active' : ''}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {addDialogOpen &&
        (departments.length ? (
          <StaffDialog title="Add staff" size="wide" onClose={() => setAddDialogOpen(false)}>
            <StaffRegistrationForm
              departments={departments}
              branches={branches}
              onCreated={(id, note) => void handleStaffCreated(id, note)}
            />
          </StaffDialog>
        ) : (
          <StaffDialog title="Add staff" onClose={() => setAddDialogOpen(false)}>
            <div className="branches-empty-state">
              <h3>Create a department first</h3>
              <p>Staff profiles need a department assignment.</p>
              <button
                type="button"
                className="dashboard-primary-button"
                onClick={() => {
                  setAddDialogOpen(false);
                  onNavigate?.('/tenant/departments');
                }}
              >
                Open departments
              </button>
            </div>
          </StaffDialog>
        ))}

      {timeOffDialogOpen && (
        <StaffDialog title="Record time off / leave" onClose={() => setTimeOffDialogOpen(false)}>
          <form className="tenant-form" onSubmit={(event) => void submitTimeOffModal(event)}>
            <div className="tenant-form-grid">
              <label>
                Staff member
                <select
                  required
                  value={timeOffForm.staffProfileId}
                  onChange={(e) => setTimeOffForm({ ...timeOffForm, staffProfileId: e.target.value })}
                >
                  <option value="">Select staff</option>
                  {staff.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName} ({m.staffNumber ?? 'No ID'})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Starts
                <input
                  required
                  type="datetime-local"
                  value={timeOffForm.startsAt}
                  onChange={(e) => setTimeOffForm({ ...timeOffForm, startsAt: e.target.value })}
                />
              </label>
              <label>
                Ends
                <input
                  required
                  type="datetime-local"
                  value={timeOffForm.endsAt}
                  onChange={(e) => setTimeOffForm({ ...timeOffForm, endsAt: e.target.value })}
                />
              </label>
              <label style={{ gridColumn: '1 / -1' }}>
                Reason
                <input
                  maxLength={1000}
                  placeholder="Annual leave, sick leave, medical appointment..."
                  value={timeOffForm.reason}
                  onChange={(e) => setTimeOffForm({ ...timeOffForm, reason: e.target.value })}
                />
              </label>
            </div>
            <div className="branches-form-actions" style={{ marginTop: '16px' }}>
              <button type="submit" className="dashboard-primary-button" disabled={saving}>
                Submit request
              </button>
              <button
                type="button"
                className="dashboard-secondary-button"
                onClick={() => setTimeOffDialogOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </StaffDialog>
      )}

      {shiftDialogOpen && (
        <StaffDialog title="Schedule shift" size="wide" onClose={() => setShiftDialogOpen(false)}>
          <form className="tenant-form" onSubmit={(event) => void submitShiftModal(event)}>
            <div className="tenant-form-grid">
              <label>
                Staff member
                <select
                  required
                  value={shiftModalForm.staffProfileId}
                  onChange={(e) => {
                    const id = e.target.value;
                    const member = staff.find((m) => m.id === id);
                    const defaultDept = member?.assignments.find((a) => a.status === 'ACTIVE')?.department.id ?? '';
                    setShiftModalForm({ ...shiftModalForm, staffProfileId: id, departmentId: defaultDept });
                  }}
                >
                  <option value="">Select staff member</option>
                  {staff.filter((m) => m.status === 'ACTIVE').map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.firstName} {m.lastName} ({m.staffNumber ?? 'No ID'})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Department
                <select
                  required
                  value={shiftModalForm.departmentId}
                  onChange={(e) => setShiftModalForm({ ...shiftModalForm, departmentId: e.target.value })}
                >
                  <option value="">Select department</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Branch
                <select
                  value={shiftModalForm.branchId}
                  onChange={(e) => setShiftModalForm({ ...shiftModalForm, branchId: e.target.value })}
                >
                  <option value="">Primary branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Shift name
                <input
                  required
                  value={shiftModalForm.shiftName}
                  onChange={(e) => setShiftModalForm({ ...shiftModalForm, shiftName: e.target.value })}
                  placeholder="Standard Day Shift, Night On-Call..."
                />
              </label>
              <label>
                Start time
                <input
                  required
                  type="time"
                  value={shiftModalForm.startTime}
                  onChange={(e) => setShiftModalForm({ ...shiftModalForm, startTime: e.target.value })}
                />
              </label>
              <label>
                End time
                <input
                  required
                  type="time"
                  value={shiftModalForm.endTime}
                  onChange={(e) => setShiftModalForm({ ...shiftModalForm, endTime: e.target.value })}
                />
              </label>
            </div>
            <div className="branches-form-actions" style={{ marginTop: '16px' }}>
              <button type="submit" className="dashboard-primary-button" disabled={saving}>
                Save shift
              </button>
              <button
                type="button"
                className="dashboard-secondary-button"
                onClick={() => setShiftDialogOpen(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        </StaffDialog>
      )}

      {editingStaffMember && (
        <StaffDialog title="Edit staff profile" size="wide" onClose={() => setEditingStaffMember(null)}>
          <StaffProfileEditor
            member={editingStaffMember}
            onCancel={() => setEditingStaffMember(null)}
            onSaved={() => {
              setEditingStaffMember(null);
              setMessage('Staff profile updated successfully.');
              void loadData();
            }}
          />
        </StaffDialog>
      )}

      {activeTab === 'assignments' && (
        <section
          id="staff-panel-assignments"
          role="tabpanel"
          aria-labelledby="staff-tab-assignments"
          className="dashboard-card"
        >
          <header className="dashboard-card-header">
            <div>
              <h2>Department assignments</h2>
              <p>Access is explicit per department and revocation takes effect immediately.</p>
            </div>
          </header>
          {staff.some((member) => member.assignments.length) ? (
            <div className="staff-record-list">
              {staff
                .flatMap((member) => member.assignments.map((assignment) => ({ member, assignment })))
                .map(({ member, assignment }) => (
                  <article className="staff-record" key={assignment.id}>
                    <div>
                      <strong>
                        {member.firstName} {member.lastName}
                      </strong>
                      <span>
                        {member.staffNumber} · {assignment.role}
                      </span>
                    </div>
                    <div>
                      <strong>
                        {assignment.department.name}
                        {assignment.isPrimaryDepartment ? ' · Primary' : ''}
                      </strong>
                      <span>{assignment.branch?.name ?? member.branch?.name ?? 'No branch'}</span>
                    </div>
                    <div>
                      <span>Access: {assignment.accessLevel}</span>
                      <span>Dashboard: {assignment.canAccessDashboard ? 'Enabled' : 'Disabled'}</span>
                    </div>
                    <div>
                      <span>{displayStatus(assignment.status ?? 'ACTIVE')}</span>
                      <span>
                        {assignment.startsAt
                          ? new Date(assignment.startsAt).toLocaleDateString()
                          : 'No start date'}
                        {assignment.endsAt
                          ? ` – ${new Date(assignment.endsAt).toLocaleDateString()}`
                          : ''}
                      </span>
                    </div>
                    {(assignment.status ?? 'ACTIVE') === 'ACTIVE' && (
                      <button
                        type="button"
                        className="dashboard-secondary-button"
                        style={{ borderColor: '#e53e3e', color: '#e53e3e' }}
                        disabled={actionFor === member.id}
                        onClick={() =>
                          void removeAssignment(
                            member,
                            assignment.id,
                            Boolean(assignment.isPrimaryDepartment),
                          )
                        }
                      >
                        Remove access
                      </button>
                    )}
                  </article>
                ))}
            </div>
          ) : (
            <div className="branches-empty-state">
              <h3>No department assignments.</h3>
            </div>
          )}
        </section>
      )}

      {activeTab === 'roster' && (
        <section
          id="staff-panel-roster"
          role="tabpanel"
          aria-labelledby="staff-tab-roster"
          className="dashboard-card"
        >
          <header className="dashboard-card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
            <div>
              <h2>Shifts & roster</h2>
              <p>Recurring assignments show schedule overlap; leave entries are stored and reviewed here.</p>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div className="staff-segmented" role="group" aria-label="Roster view">
                {(['DAY', 'WEEK', 'MONTH'] as const).map((view) => (
                  <button
                    type="button"
                    key={view}
                    className={rosterView === view ? 'is-active' : ''}
                    aria-pressed={rosterView === view}
                    onClick={() => setRosterView(view)}
                  >
                    {displayStatus(view)}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="dashboard-primary-button"
                onClick={() => setShiftDialogOpen(true)}
              >
                + Schedule Shift
              </button>
              <button
                type="button"
                className="dashboard-secondary-button"
                style={{ borderColor: '#3182ce', color: '#2b6cb0', backgroundColor: '#ebf8ff' }}
                onClick={() => setTimeOffDialogOpen(true)}
              >
                + Record Time Off
              </button>
            </div>
          </header>

          <div className="tenant-form-grid" style={{ marginBottom: '20px' }}>
            <label>
              Filter staff member
              <select
                value={selectedProfileId}
                onChange={(event) => void showTimeOff(event.target.value)}
              >
                <option value="">All active staff</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.firstName} {member.lastName} ({member.staffNumber ?? 'ID pending'})
                  </option>
                ))}
              </select>
            </label>
          </div>

          <h3 style={{ margin: '16px 0 12px 0', fontSize: '1.1rem' }}>{displayStatus(rosterView)} shifts</h3>
          {staff.flatMap((member) =>
            member.shifts
              .filter(
                (item) =>
                  (!selectedProfileId || member.id === selectedProfileId) &&
                  item.status === 'ACTIVE' &&
                  (rosterView !== 'DAY' || item.daysOfWeek?.includes(todayCode)),
              )
              .map((item) => ({ member, item })),
          ).length ? (
            <div className="staff-record-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
              {staff
                .flatMap((member) =>
                  member.shifts
                    .filter(
                      (item) =>
                        (!selectedProfileId || member.id === selectedProfileId) &&
                        item.status === 'ACTIVE' &&
                        (rosterView !== 'DAY' || item.daysOfWeek?.includes(todayCode)),
                    )
                    .map((item) => ({ member, item })),
                )
                .map(({ member, item }) => (
                  <article className="staff-record" key={item.id} style={{ display: 'flex', flexDirection: 'column', padding: '16px', background: '#ffffff', borderRadius: '8px', border: '1px solid #e2e8f0', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '1rem' }}>{member.firstName} {member.lastName}</strong>
                      <span style={{ fontSize: '0.8rem', color: '#718096', fontWeight: 600 }}>{member.staffNumber ?? 'ID pending'}</span>
                    </div>
                    <div style={{ fontSize: '0.9rem', color: '#2b6cb0', fontWeight: 600 }}>
                      {item.shiftName} · {item.department.name}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: '#4a5568' }}>
                      📍 {item.branch?.name ?? 'Primary branch'}
                    </div>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, color: '#2d3748' }}>
                      ⏰ {item.startTime}–{item.endTime}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px' }}>
                      {(item.daysOfWeek ?? []).map((day) => (
                        <span key={day} style={{ fontSize: '0.75rem', fontWeight: 'bold', padding: '2px 6px', borderRadius: '4px', backgroundColor: day === todayCode ? '#3182ce' : '#edf2f7', color: day === todayCode ? '#ffffff' : '#2d3748' }}>
                          {day}
                        </span>
                      ))}
                    </div>
                  </article>
                ))}
            </div>
          ) : (
            <div className="branches-empty-state" style={{ padding: '24px' }}>
              <h3>No shifts scheduled.</h3>
              <p>Click "Schedule Shift" above to assign working hours to team members.</p>
            </div>
          )}

          {selectedProfileId && (
            <div style={{ marginTop: '28px', paddingTop: '20px', borderTop: '2px solid #edf2f7' }}>
              <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem' }}>Leave & Time Off Requests</h3>
              {timeOff.length ? (
                <div className="staff-record-list" style={{ display: 'grid', gap: '12px' }}>
                  {timeOff.map((entry) => (
                    <article className="staff-record" key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#f7fafc', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                      <div>
                        <strong>
                          📅 {new Date(entry.startsAt).toLocaleString()} –{' '}
                          {new Date(entry.endsAt).toLocaleString()}
                        </strong>
                        <span style={{ display: 'block', fontSize: '0.85rem', color: '#4a5568', marginTop: '2px' }}>
                          Reason: {entry.reason || 'No reason provided'}
                        </span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span className="staff-status-badge" style={{ padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', fontWeight: 600, backgroundColor: entry.status === 'APPROVED' ? '#c6f6d5' : entry.status === 'REJECTED' ? '#fed7d7' : '#feebc8', color: entry.status === 'APPROVED' ? '#22543d' : entry.status === 'REJECTED' ? '#742a2a' : '#744210' }}>
                          {displayStatus(entry.status)}
                        </span>
                        {entry.status === 'REQUESTED' && (
                          <div className="branch-list-actions" style={{ display: 'flex', gap: '6px' }}>
                            <button
                              type="button"
                              className="dashboard-primary-button"
                              style={{ backgroundColor: '#38a169', borderColor: '#38a169', padding: '4px 8px', fontSize: '0.8rem' }}
                              onClick={() => void decideTimeOff(entry, 'APPROVED')}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="dashboard-secondary-button"
                              style={{ borderColor: '#e53e3e', color: '#e53e3e', padding: '4px 8px', fontSize: '0.8rem' }}
                              onClick={() => void decideTimeOff(entry, 'REJECTED')}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p style={{ color: '#718096', fontSize: '0.9rem' }}>No leave days or time-off requests found for this staff member.</p>
              )}
            </div>
          )}
        </section>
      )}

      {activeTab === 'documents' && (
        <section
          id="staff-panel-documents"
          role="tabpanel"
          aria-labelledby="staff-tab-documents"
          className="dashboard-card"
        >
          <header className="dashboard-card-header">
            <div>
              <h2>Verification & documents</h2>
              <p>Files are private. Uploads are checked for size and file signature; identity and credential authenticity require review.</p>
            </div>
          </header>
          <div className="tenant-form-grid">
            <label>
              Staff member
              <select
                value={selectedProfileId}
                onChange={(event) => void showDocuments(event.target.value)}
              >
                <option value="">Select staff</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.firstName} {member.lastName} · {member.staffNumber}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {selectedProfileId && (
            <>
              {(() => {
                const selectedStaff = staff.find((member) => member.id === selectedProfileId);
                if (!selectedStaff) return null;
                return (
                  <section className="staff-contact-verification" aria-label="Contact verification">
                    <h3>Verify contact methods</h3>
                    <div className="staff-contact-verification-grid">
                      <article>
                        <strong>Email</strong>
                        <span>{selectedStaff.email}</span>
                        <span className={`staff-status-badge ${selectedStaff.emailVerified ? 'is-verified' : ''}`}>
                          {selectedStaff.emailVerified ? 'Verified' : 'Not verified'}
                        </span>
                        {!selectedStaff.emailVerified ? <button type="button" className="dashboard-secondary-button" disabled={verificationSaving} onClick={() => void requestContactCode('EMAIL')}>Send email code</button> : null}
                      </article>
                      <article>
                        <strong>Phone</strong>
                        <span>{selectedStaff.phone || 'No phone number on file'}</span>
                        <span className={`staff-status-badge ${selectedStaff.phoneVerified ? 'is-verified' : ''}`}>
                          {selectedStaff.phoneVerified ? 'Verified' : 'Not verified'}
                        </span>
                        {!selectedStaff.phoneVerified ? <button type="button" className="dashboard-secondary-button" disabled={verificationSaving || !selectedStaff.phone} onClick={() => void requestContactCode('PHONE')}>Send phone code</button> : null}
                      </article>
                    </div>
                    {verificationChallenge ? (
                      <form className="staff-contact-code-form" onSubmit={(event) => { event.preventDefault(); void submitContactCode(); }}>
                        <p>Enter the six-digit code sent to {verificationChallenge.target}. Code expires {new Date(verificationChallenge.expiresAt).toLocaleString()}.</p>
                        <label htmlFor="staff-contact-verification-code">Verification code</label>
                        <input id="staff-contact-verification-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={verificationCode} onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} />
                        <button type="submit" className="dashboard-primary-button" disabled={verificationSaving || verificationCode.length !== 6}>{verificationSaving ? 'Verifying…' : 'Verify code'}</button>
                      </form>
                    ) : null}
                  </section>
                );
              })()}
              <div className="staff-upload-row">
                <label>
                  Document type
                  <select
                    value={newDocumentType}
                    onChange={(event) => setNewDocumentType(event.target.value)}
                  >
                    {[
                      ['PROFILE_PHOTO', 'Profile photo'],
                      ['NATIONAL_ID', 'National ID'],
                      ['PASSPORT', 'Passport'],
                      ['CV', 'CV'],
                      ['PROFESSIONAL_LICENSE', 'Professional license'],
                      ['DEGREE_CERTIFICATE', 'Degree certificate'],
                      ['GOOD_STANDING_CERTIFICATE', 'Good standing'],
                      ['INSURANCE_INDEMNITY', 'Insurance / indemnity'],
                      ['OTHER', 'Other'],
                    ].map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Upload private file
                  <input
                    type="file"
                    accept="application/pdf,image/jpeg,image/png,image/webp"
                    disabled={saving}
                    onChange={(event) => void uploadDocumentForSelected(event.target.files?.[0])}
                  />
                </label>
                {documents.some((entry) => entry.type === 'PROFILE_PHOTO') && (
                  <button
                    type="button"
                    className="dashboard-secondary-button"
                    style={{ borderColor: '#e53e3e', color: '#e53e3e' }}
                    onClick={() => void removeSelectedPhoto()}
                  >
                    Remove profile photo
                  </button>
                )}
              </div>
              {documents.length ? (
                <div className="staff-record-list">
                  {documents.map((entry) => (
                    <article className="staff-record" key={entry.id}>
                      <div>
                        <strong>{entry.fileName}</strong>
                        <span>
                          {displayStatus(entry.type)} · {(entry.sizeBytes / (1024 * 1024)).toFixed(2)}{' '}
                          MB · {new Date(entry.createdAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div>
                        <span className="staff-status-badge">{displayStatus(entry.status)}</span>
                        <span>
                          Uploaded by {entry.uploadedBy?.displayName ?? entry.uploadedById}
                        </span>
                      </div>
                      <div>
                        <span>
                          {entry.reviewedBy
                            ? `Reviewed by ${entry.reviewedBy.displayName}`
                            : 'Awaiting review'}
                        </span>
                        <span>{entry.reviewNotes ?? ''}</span>
                      </div>
                      <div className="branch-list-actions">
                        <button
                          type="button"
                          className="dashboard-secondary-button"
                          onClick={() => void downloadDocument(selectedProfileId, entry)}
                        >
                          Download
                        </button>
                        {['UPLOADED', 'UNDER_REVIEW'].includes(entry.status) && (
                          <>
                            <button
                              type="button"
                              className="dashboard-primary-button"
                              style={{ backgroundColor: '#38a169', borderColor: '#38a169' }}
                              disabled={actionFor === entry.id}
                              onClick={() => void reviewDocument(selectedProfileId, entry, 'VERIFIED')}
                            >
                              Verify
                            </button>
                            <button
                              type="button"
                              className="dashboard-secondary-button"
                              style={{ borderColor: '#e53e3e', color: '#e53e3e' }}
                              disabled={actionFor === entry.id}
                              onClick={() => void reviewDocument(selectedProfileId, entry, 'REJECTED')}
                            >
                              Reject
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="dashboard-secondary-button"
                          style={{ borderColor: '#e53e3e', color: '#e53e3e' }}
                          onClick={() => void deleteDocument(selectedProfileId, entry)}
                        >
                          Delete
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="branches-empty-state">
                  <h3>No documents uploaded.</h3>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {activeTab === 'history' && (
        <section
          id="staff-panel-history"
          role="tabpanel"
          aria-labelledby="staff-tab-history"
          className="dashboard-card"
        >
          <header className="dashboard-card-header">
            <div>
              <h2>Access history</h2>
              <p>Department access attempts are shown with time, branch context, IP, and device metadata.</p>
            </div>
          </header>
          <div className="tenant-form-grid">
            <label>
              Staff member
              <select
                value={selectedProfileId}
                onChange={(event) => {
                  const id = event.target.value;
                  setSelectedProfileId(id);
                  const member = staff.find((item) => item.id === id);
                  if (member) void showAccessHistory(member);
                }}
              >
                <option value="">Select staff</option>
                {staff.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.firstName} {member.lastName} · {member.staffNumber}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {historyFor && accessHistory?.length ? (
            <div className="staff-record-list">
              {accessHistory.map((entry) => (
                <article className="staff-record" key={entry.id}>
                  <div>
                    <strong>{displayStatus(entry.action ?? entry.status)}</strong>
                    <span>{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  <div>
                    <span>{entry.department?.name ?? entry.resource ?? 'Department unavailable'}</span>
                    <span>User {entry.userId}</span>
                  </div>
                  <div>
                    <span>
                      {displayStatus(entry.status)} · {entry.ipAddress ?? 'IP unavailable'}
                    </span>
                    <span>{entry.userAgent ?? 'Device unavailable'}</span>
                  </div>
                </article>
              ))}
            </div>
          ) : historyFor ? (
            <div className="branches-empty-state">
              <h3>No access history available.</h3>
            </div>
          ) : null}
        </section>
      )}

      {activeTab === 'analytics' && (
        <section
          id="staff-panel-analytics"
          role="tabpanel"
          aria-labelledby="staff-tab-analytics"
          className="dashboard-card"
        >
          <header className="dashboard-card-header">
            <div>
              <h2>Staff analytics</h2>
              <p>Current workforce status and professional mix.</p>
            </div>
          </header>
          <div className="staff-analytics-grid">
            {[
              ['Active', activeCount],
              ['Clinicians', clinicianCount],
              ['Verified clinicians', verifiedClinicianCount],
              ['Accept online bookings', bookingClinicianCount],
              ['On duty today', onDutyCount],
              ['Protected departments', protectedDepartmentCount],
              ['Suspended / offboarded', suspendedCount],
            ].map(([label, value]) => (
              <div className="staff-analytics-row" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <meter min="0" max={Math.max(staff.length, 1)} value={Number(value)} />
              </div>
            ))}
          </div>
          <h3>Professional category</h3>
          <div className="staff-category-grid">
            {Array.from(
              new Set(staff.map((member) => member.professionalCategory).filter(Boolean)),
            ).map((category) => (
              <div key={category}>
                <span>{displayStatus(category!)}</span>
                <strong>
                  {staff.filter((member) => member.professionalCategory === category).length}
                </strong>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeTab === 'directory' && (
        <section
          id="staff-panel-directory"
          role="tabpanel"
          aria-labelledby="staff-tab-directory"
          className="dashboard-card"
        >
          <div className="dashboard-card-header">
            <div>
              <h2>Staff directory</h2>
              <p>
                Showing {filteredStaff.length} of {staff.length} staff members
              </p>
            </div>
          </div>
          <div className="tenant-form-grid">
            <label>
              Search staff
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Name, email, staff number, job title or phone"
              />
            </label>
            <label>
              Department
              <select
                value={departmentFilter}
                onChange={(event) => setDepartmentFilter(event.target.value)}
              >
                <option value="">All departments</option>
                {departments.map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Staff status
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="SUSPENDED">Suspended</option>
                <option value="ON_LEAVE">On leave</option>
                <option value="OFFBOARDED">Offboarded</option>
              </select>
            </label>
            <label>Branch<select value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}><option value="">All branches</option>{branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
            <label>Professional category<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="">All categories</option>{Array.from(new Set(staff.map((member) => member.professionalCategory).filter(Boolean))).map((category) => <option key={category} value={category!}>{displayStatus(category!)}</option>)}</select></label>
            <label>Document verification<select value={verificationFilter} onChange={(event) => setVerificationFilter(event.target.value)}><option value="">All documents</option>{['PROFILE_INCOMPLETE', 'DOCUMENTS_PENDING', 'DOCUMENTS_UNDER_REVIEW', 'VERIFIED', 'REJECTED'].map((status) => <option key={status} value={status}>{displayStatus(status)}</option>)}</select></label>
            <label>Department role<select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}><option value="">All roles</option>{Array.from(new Set(staff.flatMap((member) => member.assignments.map((item) => item.role)))).map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
            <label>Department access<select value={accessFilter} onChange={(event) => setAccessFilter(event.target.value)}><option value="">All access levels</option>{['VIEW', 'OPERATE', 'MANAGE', 'ADMIN'].map((level) => <option key={level} value={level}>{displayStatus(level)}</option>)}</select></label>
          </div>
          <div className="staff-bulk-actions">
            <label className="staff-toggle"><input type="checkbox" checked={filteredStaff.length > 0 && filteredStaff.every((member) => selectedStaffIds.includes(member.id))} onChange={(event) => setSelectedStaffIds(event.target.checked ? filteredStaff.map((member) => member.id) : [])} />Select filtered ({selectedStaffIds.length})</label>
            <button type="button" className="dashboard-secondary-button" disabled={!selectedStaffIds.length || saving} onClick={() => void runBulkAction('SUSPEND')}>Suspend selected</button>
            <button type="button" className="dashboard-secondary-button" disabled={!selectedStaffIds.length || saving} onClick={() => void runBulkAction('REACTIVATE')}>Reactivate selected</button>
            <select aria-label="Bulk department" value={bulkDepartmentId} onChange={(event) => setBulkDepartmentId(event.target.value)}><option value="">Department for bulk access</option>{departments.filter((department) => department.status === 'ACTIVE').map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select>
            <input aria-label="Department role for bulk access" value={bulkRole} onChange={(event) => setBulkRole(event.target.value)} maxLength={100} />
            <button type="button" className="dashboard-secondary-button" disabled={!selectedStaffIds.length || !bulkDepartmentId || saving} onClick={() => void runBulkAction('ASSIGN')}>Assign department</button>
            <button type="button" className="dashboard-secondary-button" disabled={!selectedStaffIds.length || !bulkDepartmentId || saving} onClick={() => void runBulkAction('REMOVE')}>Remove department</button>
          </div>
          {filteredStaff.length === 0 ? (
            <div className="branches-empty-state">
              <h3>{staff.length ? 'No staff match these filters' : 'No staff yet'}</h3>
              <p>Adjust your search or filters, or add a team member.</p>
            </div>
          ) : (
            <div className="branches-list">
              {filteredStaff.map((member) => {
                const expanded = expandedId === member.id;
                const assignments = member.assignments;
                return (
                  <article key={member.id} className="branch-list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px', padding: '16px' }}>
                    <div className="branch-list-main" style={{ display: 'flex', alignItems: 'flex-start', gap: '16px', width: '100%' }}>
                      <label className="staff-row-select" style={{ marginTop: '4px' }} aria-label={`Select ${member.firstName} ${member.lastName}`}>
                        <input type="checkbox" checked={selectedStaffIds.includes(member.id)} onChange={(event) => setSelectedStaffIds((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} />
                      </label>
                      <StaffAvatar member={member} />
                      
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                          <h3 style={{ margin: 0, fontSize: '1.1rem' }}>
                            {member.firstName} {member.lastName}
                          </h3>
                          <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-secondary, #666)' }}>
                            {member.staffNumber ?? 'Staff ID pending'}
                          </span>
                          <span className={`staff-status-badge status-${member.status?.toLowerCase() || 'active'}`} style={{ padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase', backgroundColor: member.status === 'ACTIVE' ? '#e6fffa' : '#fff5f5', color: member.status === 'ACTIVE' ? '#2c7a7b' : '#c53030', border: `1px solid ${member.status === 'ACTIVE' ? '#319795' : '#e53e3e'}` }}>
                            {member.status === 'INVITED' ? 'Pending activation' : displayStatus(member.status)}
                          </span>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.88rem', color: 'var(--text-secondary, #4a5568)' }}>
                          <span>📧 {member.email}</span>
                          {member.phone && <span>📞 {member.phone}</span>}
                          <span>💼 {member.jobTitle ?? 'No professional title'}</span>
                          <span>🏷️ {member.professionalCategory ? displayStatus(member.professionalCategory) : 'Category not set'}{member.specialty ? ` (${member.specialty})` : ''}</span>
                        </div>

                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '0.85rem', color: '#718096' }}>
                          <span>🏢 {member.branch ? `Branch: ${member.branch.name}` : 'No primary branch'}</span>
                          <span>📄 Documents: <strong>{displayStatus(member.verificationStatus)}</strong></span>
                          <span>🔐 Setup: {
                            member.passwordConfigured
                              ? 'Password set'
                              : member.emailVerified
                                ? member.registrationStatus === 'ONBOARDING'
                                  ? 'Password setup email sent'
                                  : 'Administrator approval required'
                                : 'Email verification required'
                          }</span>
                        </div>

                        {assignments.length > 0 && (
                          <div style={{ marginTop: '2px', fontSize: '0.85rem' }}>
                            <strong style={{ color: '#4a5568' }}>Departments: </strong>
                            <span style={{ color: '#2b6cb0', fontWeight: 500 }}>
                              {assignments.map((item) => `${item.department.name} (${item.role})`).join(' · ')}
                            </span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="branch-list-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', borderTop: '1px solid #edf2f7', paddingTop: '12px', marginTop: '4px' }}>
                      <button
                        type="button"
                        className="dashboard-secondary-button"
                        style={{ borderColor: '#3182ce', color: '#2b6cb0', backgroundColor: '#ebf8ff' }}
                        onClick={() => {
                          setExpandedId(expanded ? null : member.id);
                          setShowAssignmentFor(null);
                          setShowShiftFor(null);
                          setHistoryFor(null);
                          setAccessHistory(null);
                        }}
                      >
                        {expanded ? 'Hide profile' : 'View profile'}
                      </button>
                      <button 
                        type="button" 
                        className="dashboard-secondary-button" 
                        style={{ borderColor: '#4a5568', color: '#2d3748' }}
                        onClick={() => setEditingStaffMember(member)}
                      >
                        Edit profile
                      </button>
                      {member.status === 'INVITED' && !member.passwordConfigured && (
                        <button
                          type="button"
                          className="dashboard-primary-button"
                          disabled={actionFor === member.id}
                          onClick={() => void handleProgressInvitation(member)}
                        >
                          {actionFor === member.id
                            ? 'Sending...'
                            : !member.emailVerified
                              ? 'Resend verification email'
                              : member.registrationStatus === 'ONBOARDING'
                                ? 'Resend password setup email'
                                : 'Approve & send setup email'}
                        </button>
                      )}
                      {member.status === 'ACTIVE' && (
                        <button 
                          type="button" 
                          className="dashboard-secondary-button" 
                          style={{ borderColor: '#319795', color: '#2c7a7b', backgroundColor: '#e6fffa' }}
                          onClick={() => { 
                            setExpandedId(member.id); 
                            setShowShiftFor(member.id); 
                            setShiftModalForm((current) => ({ ...current, staffProfileId: member.id, departmentId: assignments.find((item) => item.status === 'ACTIVE')?.department.id ?? '', branchId: member.branchId ?? '' }));
                          }}
                        >
                          Shifts
                        </button>
                      )}
                      {member.status !== 'OFFBOARDED' && member.status !== 'INVITED' && (
                        <button
                          type="button"
                          className="dashboard-secondary-button"
                          style={{ 
                            borderColor: member.status === 'ACTIVE' ? '#dd6b20' : '#38a169', 
                            color: member.status === 'ACTIVE' ? '#c05621' : '#2f855a',
                            backgroundColor: member.status === 'ACTIVE' ? '#fffaf0' : '#f0fff4'
                          }}
                          disabled={actionFor === member.id}
                          onClick={() => void changeStatus(member)}
                        >
                          {member.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                        </button>
                      )}
                      {member.status !== 'OFFBOARDED' && member.status !== 'INVITED' && (
                        <button 
                          type="button" 
                          className="dashboard-secondary-button" 
                          style={{ borderColor: '#e53e3e', color: '#c53030', backgroundColor: '#fff5f5' }}
                          disabled={actionFor === member.id} 
                          onClick={() => void offboardStaff(member)}
                        >
                          Offboard
                        </button>
                      )}
                      <button 
                        type="button" 
                        className="dashboard-secondary-button" 
                        style={{ borderColor: '#553c9a', color: '#6b46c1', backgroundColor: '#faf5ff' }}
                        onClick={() => { setActiveTab('documents'); void showDocuments(member.id); }}
                      >
                        Documents
                      </button>
                    </div>

                    {expanded && (
                      <div style={{ width: '100%', borderTop: '1px dashed #cbd5e0', paddingTop: '16px', marginTop: '8px' }}>
                        <div className="staff-profile-heading"><StaffAvatar member={member} size="large" /><div><strong>{member.firstName} {member.middleName} {member.lastName}</strong><span>{member.professionalCategory ? displayStatus(member.professionalCategory) : member.jobTitle}</span></div></div>
                        <div className="detail-grid">
                          <div>
                            <span>Phone</span>
                            <strong>{member.phone ?? 'Not provided'}</strong>
                          </div>
                          <div>
                            <span>License</span>
                            <strong>{member.licenseNumber ?? 'Not provided'}</strong>
                          </div>
                          <div>
                            <span>Specialty</span>
                            <strong>{member.specialty ?? 'Not provided'}</strong>
                          </div>
                          <div>
                            <span>Qualifications</span>
                            <strong>{member.qualifications ?? 'Not provided'}</strong>
                          </div>
                          <div>
                            <span>Reports to</span>
                            <strong>
                              {member.reportsTo
                                ? `${member.reportsTo.firstName} ${member.reportsTo.lastName}`
                                : 'Not assigned'}
                            </strong>
                          </div>
                          <div>
                            <span>Joined</span>
                            <strong>
                              {member.joinedAt
                                ? new Date(member.joinedAt).toLocaleDateString()
                                : 'Not recorded'}
                            </strong>
                          </div>
                        </div>
                        <h4>Department assignments</h4>
                        {assignments.length ? (
                          <div className="branches-list">
                            {assignments.map((item) => (
                              <div key={item.id} className="branch-list-item">
                                <div className="branch-list-meta">
                                  <strong>
                                    {item.department.name}
                                    {item.isPrimaryDepartment ? ' · Primary' : ''}
                                  </strong>
                                  <span>
                                    Role: {item.role} · Access: {item.accessLevel}
                                  </span>
                                  <span>Dashboard: {item.canAccessDashboard ? 'Enabled' : 'Disabled'} · {item.department.requiresDepartmentPassword ? 'Protected department' : 'Standard department'}</span>
                                  <span>
                                    Branch: {item.branch?.name ?? 'Not assigned'} ·{' '}
                                    {displayStatus(item.status ?? 'ACTIVE')}
                                  </span>
                                </div>
                                {(item.status ?? 'ACTIVE') === 'ACTIVE' && <button type="button" className="dashboard-secondary-button" style={{ borderColor: '#e53e3e', color: '#e53e3e' }} disabled={actionFor === member.id} onClick={() => void removeAssignment(member, item.id, Boolean(item.isPrimaryDepartment))}>Remove access</button>}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p>No department assignments.</p>
                        )}
                        <h4>Active shifts</h4>
                        {member.shifts.length ? (
                          <div className="branches-list">
                            {member.shifts.map((item) => (
                              <div key={item.id} className="branch-list-item">
                                <div className="branch-list-meta">
                                  <strong>
                                    {item.shiftName} · {item.department.name}
                                  </strong>
                                  <span>
                                    {item.startTime}–{item.endTime} ·{' '}
                                    {(item.daysOfWeek ?? []).join(', ')}
                                  </span>
                                  <span>Branch: {item.branch?.name ?? 'Not assigned'}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p>No active shifts assigned.</p>
                        )}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      <div className="branches-footer-actions">
        <button
          type="button"
          className="dashboard-secondary-button"
          onClick={() => onNavigate?.('/tenant/branches')}
        >
          Back to branches
        </button>

        <button
          type="button"
          className="dashboard-secondary-button"
          onClick={() => onNavigate?.('/tenant/organization')}
        >
          Organization profile
        </button>
      </div>
    </main>
  );
}
