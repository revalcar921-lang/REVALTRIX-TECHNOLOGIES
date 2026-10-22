import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CalendarDays, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { getBranches } from '../../branches/api/branches.api.js';
import type { Branch } from '../../branches/types/branch.types.js';
import { getDepartments } from '../../departments/api/departments.api.js';
import type { Department } from '../../departments/types/department.types.js';
import { PROFESSIONAL_TITLE_OPTIONS } from '../../staff/types/professional-title-options.js';
import { getServices } from '../../services/api/services.api.js';
import type { Service } from '../../services/types/service.types.js';
import {
  createProvider,
  createProviderAvailability,
  deactivateProviderAvailability,
  getEligibleProviderStaff,
  getProviderAvailability,
  getProviders,
  type ProviderAvailability,
  type ProviderProfile,
  type ProviderType,
  type EligibleProviderStaff,
} from '../api/providers.api.js';
import './ProvidersPage.css';

const weekdays = [
  ['Sunday', 0], ['Monday', 1], ['Tuesday', 2], ['Wednesday', 3],
  ['Thursday', 4], ['Friday', 5], ['Saturday', 6],
] as const;

function dateInputValue(date: Date): string {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function timeLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function providerTypeForStaff(staff: EligibleProviderStaff): ProviderType {
  const staffTitle = staff.jobTitle?.trim().toLowerCase();
  const title = PROFESSIONAL_TITLE_OPTIONS.find((option) =>
    option.jobTitle.toLowerCase() === staffTitle || option.label.toLowerCase() === staffTitle,
  ) ?? PROFESSIONAL_TITLE_OPTIONS.find((option) =>
    option.category === staff.professionalCategory &&
    !['ADMIN', 'RECEPTIONIST', 'OTHER'].includes(option.category),
  );
  return title?.providerType ?? 'OTHER';
}

function providerNumberForStaff(staff: EligibleProviderStaff): string {
  return staff.staffNumber?.trim() || `PROV-${staff.id.slice(0, 8).toUpperCase()}`;
}

export function ProvidersPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const [providers, setProviders] = useState<ProviderProfile[]>([]);
  const [eligibleStaff, setEligibleStaff] = useState<EligibleProviderStaff[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [availability, setAvailability] = useState<ProviderAvailability[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [providerForm, setProviderForm] = useState({ userId: '', providerNumber: '', providerType: 'PHYSICIAN' as ProviderType, professionalTitle: '', specialty: '', licenseNumber: '' });
  const [schedule, setSchedule] = useState({ branchId: '', departmentId: '', serviceId: '', dayOfWeek: '1', startTime: '09:00', endTime: '17:00', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Nairobi', effectiveFrom: dateInputValue(new Date()) });

  const activeBranches = branches.filter((branch) => branch.status === 'ACTIVE');
  const activeDepartments = departments.filter((department) =>
    department.status === 'ACTIVE' && (!department.branchId || department.branchId === schedule.branchId),
  );
  const activeServices = useMemo(() => services.filter((service) =>
    service.status === 'ACTIVE' &&
    (!service.branchId || service.branchId === schedule.branchId) &&
    (!service.departmentId || service.departmentId === schedule.departmentId),
  ), [schedule.branchId, schedule.departmentId, services]);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const [providerResult, staffList, branchList, departmentList, serviceList] = await Promise.all([
        getProviders(), getEligibleProviderStaff(), getBranches(), getDepartments(), getServices(),
      ]);
      setProviders(providerResult.items);
      setEligibleStaff(staffList);
      setBranches(branchList);
      setDepartments(departmentList);
      setServices(serviceList);
      setSelectedProviderId((current) => providerResult.items.some((provider) => provider.id === current)
        ? current
        : providerResult.items[0]?.id ?? '');
      if (!providerForm.userId && staffList.length) {
        const staff = staffList[0]!;
        setProviderForm({
          userId: staff.user.id,
          providerNumber: providerNumberForStaff(staff),
          providerType: providerTypeForStaff(staff),
          professionalTitle: staff.jobTitle ?? '',
          specialty: staff.specialty ?? '',
          licenseNumber: staff.licenseNumber ?? '',
        });
        const shift = staff.shifts[0];
        if (shift) {
          const firstDay = shift.daysOfWeek?.[0]?.slice(0, 3).toUpperCase();
          const matchingDay = weekdays.find(([name]) => name.slice(0, 3).toUpperCase() === firstDay)?.[1];
          setSchedule((current) => ({
            ...current,
            branchId: shift.branchId ?? staff.branchId ?? current.branchId,
            departmentId: shift.departmentId,
            serviceId: staff.serviceIds[0] ?? current.serviceId,
            dayOfWeek: matchingDay === undefined ? current.dayOfWeek : String(matchingDay),
            startTime: shift.startTime.slice(0, 5),
            endTime: shift.endTime.slice(0, 5),
          }));
        }
      }
      if (!schedule.branchId && branchList.length) setSchedule((current) => ({ ...current, branchId: branchList.find((branch) => branch.status === 'ACTIVE')?.id ?? '' }));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load provider setup.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  function selectStaff(userId: string): void {
    const staff = eligibleStaff.find((candidate) => candidate.user.id === userId);
    if (!staff) return;
    setProviderForm({
      userId,
      providerNumber: providerNumberForStaff(staff),
      providerType: providerTypeForStaff(staff),
      professionalTitle: staff.jobTitle ?? '',
      specialty: staff.specialty ?? '',
      licenseNumber: staff.licenseNumber ?? '',
    });
    const shift = staff.shifts[0];
    const firstDay = shift?.daysOfWeek?.[0]?.slice(0, 3).toUpperCase();
    const matchingDay = weekdays.find(([name]) => name.slice(0, 3).toUpperCase() === firstDay)?.[1];
    setSchedule((current) => ({
      ...current,
      branchId: shift?.branchId ?? staff.branchId ?? current.branchId,
      departmentId: shift?.departmentId ?? staff.departmentId ?? current.departmentId,
      serviceId: staff.serviceIds[0] ?? current.serviceId,
      dayOfWeek: matchingDay === undefined ? current.dayOfWeek : String(matchingDay),
      startTime: shift?.startTime.slice(0, 5) ?? current.startTime,
      endTime: shift?.endTime.slice(0, 5) ?? current.endTime,
    }));
  }

  useEffect(() => {
    if (!selectedProviderId) {
      setAvailability([]);
      return;
    }
    let cancelled = false;
    void getProviderAvailability(selectedProviderId)
      .then((rules) => { if (!cancelled) setAvailability(rules); })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load availability.');
      });
    return () => { cancelled = true; };
  }, [selectedProviderId]);

  async function submitProvider(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createProvider({
        ...providerForm,
        professionalTitle: providerForm.professionalTitle.trim() || undefined,
        specialty: providerForm.specialty.trim() || undefined,
        licenseNumber: providerForm.licenseNumber.trim() || undefined,
      });
      setProviders((current) => [...current, created].sort((left, right) => left.user.displayName.localeCompare(right.user.displayName)));
      setEligibleStaff((current) => current.filter((staff) => staff.user.id !== providerForm.userId));
      setSelectedProviderId(created.id);
      setProviderForm({ userId: '', providerNumber: '', providerType: 'PHYSICIAN', professionalTitle: '', specialty: '', licenseNumber: '' });
      setNotice('Provider profile created. Add weekly availability so appointments can discover bookable times.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to create provider profile.');
    } finally {
      setSaving(false);
    }
  }

  async function submitAvailability(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedProviderId) return;
    const [startHour, startMinute] = schedule.startTime.split(':').map(Number);
    const [endHour, endMinute] = schedule.endTime.split(':').map(Number);
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createProviderAvailability(selectedProviderId, {
        branchId: schedule.branchId,
        departmentId: schedule.departmentId,
        serviceId: schedule.serviceId,
        dayOfWeek: Number(schedule.dayOfWeek),
        startMinute: startHour! * 60 + startMinute!,
        endMinute: endHour! * 60 + endMinute!,
        timeZone: schedule.timeZone,
        effectiveFrom: schedule.effectiveFrom,
      });
      setAvailability((current) => [...current, created].sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.startMinute - right.startMinute));
      setNotice('Availability saved and linked to the selected branch, department, and service.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to save availability.');
    } finally {
      setSaving(false);
    }
  }

  async function removeAvailability(availabilityId: string): Promise<void> {
    if (!selectedProviderId) return;
    setSaving(true);
    setError(null);
    try {
      await deactivateProviderAvailability(selectedProviderId, availabilityId);
      setAvailability((current) => current.filter((rule) => rule.id !== availabilityId));
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Unable to remove availability.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="provider-setup-page">
      <header className="provider-setup-heading">
        <div><p className="dashboard-eyebrow">PEOPLE & SCHEDULING</p><h1>Providers</h1><p>Manage care-team profiles and live appointment availability.</p></div>
        <button type="button" className="provider-setup-refresh" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Refresh</button>
      </header>
      {error ? <p className="provider-setup-alert is-error" role="alert">{error}</p> : null}
      {notice ? <p className="provider-setup-alert" role="status">{notice}</p> : null}
      {loading ? <p role="status">Loading provider setup…</p> : (
        <>
          <section className="provider-setup-section">
            <header><div><h2>Provider profiles</h2><p>Choose an active organization member and make them available for appointment scheduling.</p></div></header>
            {providers.length ? <div className="provider-setup-list" role="list" aria-label="Provider profiles">
              {providers.map((provider) => <button type="button" role="listitem" key={provider.id} className={selectedProviderId === provider.id ? 'is-selected' : ''} onClick={() => setSelectedProviderId(provider.id)} aria-pressed={selectedProviderId === provider.id}><strong>{provider.user.displayName}</strong><span>{provider.professionalTitle || provider.providerType.replaceAll('_', ' ').toLowerCase()}{provider.specialty ? ` · ${provider.specialty}` : ''}</span><small>{provider.providerNumber}</small></button>)}
            </div> : <p className="provider-setup-empty">No provider profiles have been configured.</p>}
            <form className="provider-setup-form" onSubmit={(event) => void submitProvider(event)}>
              <h3><Plus size={17} /> Add provider</h3>
              <div className="provider-setup-grid">
                <label>Professional staff<select required value={providerForm.userId} onChange={(event) => selectStaff(event.target.value)} disabled={!eligibleStaff.length}><option value="">{eligibleStaff.length ? 'Select staff member' : 'No eligible professional staff'}</option>{eligibleStaff.map((staff) => <option value={staff.user.id} key={staff.user.id}>{staff.user.displayName} · {staff.jobTitle ?? staff.professionalCategory}</option>)}</select></label>
                <label>Provider number<input required maxLength={100} value={providerForm.providerNumber} onChange={(event) => setProviderForm((current) => ({ ...current, providerNumber: event.target.value }))} /></label>
                <label>Provider type<select value={providerForm.providerType} onChange={(event) => setProviderForm((current) => ({ ...current, providerType: event.target.value as ProviderType }))}>{PROFESSIONAL_TITLE_OPTIONS.map((option) => <option value={option.providerType} key={option.label}>{option.label}</option>)}</select></label>
                <label>Professional title<input readOnly value={providerForm.professionalTitle} /></label>
                <label>Specialty<input maxLength={200} value={providerForm.specialty} onChange={(event) => setProviderForm((current) => ({ ...current, specialty: event.target.value }))} /></label>
                <label>License number<input maxLength={150} value={providerForm.licenseNumber} onChange={(event) => setProviderForm((current) => ({ ...current, licenseNumber: event.target.value }))} /></label>
              </div>
              <button type="submit" disabled={saving || !eligibleStaff.length}><Plus size={16} /> {saving ? 'Saving…' : 'Create provider'}</button>
            </form>
          </section>

          {selectedProviderId ? <section className="provider-setup-section">
            <header><div><h2>Weekly availability</h2><p>Each rule links a provider to one branch, department, and service. Appointment discovery uses these rules.</p></div></header>
            <form className="provider-setup-form" onSubmit={(event) => void submitAvailability(event)}>
              <h3><CalendarDays size={17} /> Add availability</h3>
              <div className="provider-setup-grid">
                <label>Branch<select required value={schedule.branchId} onChange={(event) => setSchedule((current) => ({ ...current, branchId: event.target.value, departmentId: '', serviceId: '' }))}><option value="">Choose branch</option>{activeBranches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</select></label>
                <label>Department<select required value={schedule.departmentId} onChange={(event) => setSchedule((current) => ({ ...current, departmentId: event.target.value, serviceId: '' }))} disabled={!schedule.branchId}><option value="">Choose department</option>{activeDepartments.map((department) => <option value={department.id} key={department.id}>{department.name}</option>)}</select></label>
                <label>Service<select required value={schedule.serviceId} onChange={(event) => setSchedule((current) => ({ ...current, serviceId: event.target.value }))} disabled={!schedule.departmentId}><option value="">Choose service</option>{activeServices.map((service) => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label>
                <label>Day<select value={schedule.dayOfWeek} onChange={(event) => setSchedule((current) => ({ ...current, dayOfWeek: event.target.value }))}>{weekdays.map(([label, day]) => <option value={day} key={day}>{label}</option>)}</select></label>
                <label>Available from<input required type="time" value={schedule.startTime} onChange={(event) => setSchedule((current) => ({ ...current, startTime: event.target.value }))} /></label>
                <label>Available until<input required type="time" value={schedule.endTime} onChange={(event) => setSchedule((current) => ({ ...current, endTime: event.target.value }))} /></label>
                <label>Time zone<input required maxLength={100} value={schedule.timeZone} onChange={(event) => setSchedule((current) => ({ ...current, timeZone: event.target.value }))} /></label>
                <label>Effective from<input required type="date" value={schedule.effectiveFrom} onChange={(event) => setSchedule((current) => ({ ...current, effectiveFrom: event.target.value }))} /></label>
              </div>
              <button type="submit" disabled={saving || !activeBranches.length || !activeDepartments.length || !activeServices.length}><CalendarDays size={16} /> {saving ? 'Saving…' : 'Save availability'}</button>
            </form>
            <div className="provider-availability-list">
              <h3>Active rules for {providers.find((provider) => provider.id === selectedProviderId)?.user.displayName}</h3>
              {availability.length ? availability.map((rule) => <article key={rule.id}><span><strong>{weekdays.find(([, day]) => day === rule.dayOfWeek)?.[0]} · {timeLabel(rule.startMinute)}–{timeLabel(rule.endMinute)}</strong><small>{rule.branch.name} · {rule.department.name} · {rule.service.name} · {rule.timeZone}</small></span><button type="button" aria-label="Remove availability" title="Remove availability" disabled={saving} onClick={() => void removeAvailability(rule.id)}><Trash2 size={16} /></button></article>) : <p className="provider-setup-empty">No active availability configured for this provider.</p>}
            </div>
          </section> : null}
          {!providers.length && !eligibleStaff.length ? <p className="provider-setup-help">Add professional staff before creating a provider profile. <button type="button" onClick={() => onNavigate('/tenant/staff')}>Open staff</button></p> : null}
        </>
      )}
    </main>
  );
}