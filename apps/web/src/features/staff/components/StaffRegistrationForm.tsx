import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getServices } from '../../services/api/services.api.js';
import type { Service } from '../../services/types/service.types.js';
import type { Branch } from '../../branches/types/branch.types.js';
import type { Department } from '../../departments/types/department.types.js';
import { createStaff, uploadStaffDocument } from '../api/staff.api.js';
import type { CreateStaffInput, StaffMember, StaffProfessionalCategory } from '../types/staff.types.js';

const DAYS = [
  ['MON', 'Mon'], ['TUE', 'Tue'], ['WED', 'Wed'], ['THU', 'Thu'],
  ['FRI', 'Fri'], ['SAT', 'Sat'], ['SUN', 'Sun'],
] as const;

const TITLES: Array<{ label: string; jobTitle: string; category: StaffProfessionalCategory }> = [
  { label: 'Dr.', jobTitle: 'Doctor', category: 'DOCTOR' },
  { label: 'Dentist', jobTitle: 'Dentist', category: 'DENTIST' },
  { label: 'Nurse', jobTitle: 'Nurse', category: 'NURSE' },
  { label: 'Midwife', jobTitle: 'Midwife', category: 'MIDWIFE' },
  { label: 'Pharmacist', jobTitle: 'Pharmacist', category: 'PHARMACIST' },
  { label: 'Lab Scientist', jobTitle: 'Laboratory Scientist', category: 'LAB_SCIENTIST' },
  { label: 'Radiographer', jobTitle: 'Radiographer', category: 'RADIOGRAPHER' },
  { label: 'Physiotherapist', jobTitle: 'Physiotherapist', category: 'PHYSIOTHERAPIST' },
  { label: 'Nutritionist', jobTitle: 'Nutritionist', category: 'NUTRITIONIST' },
  { label: 'Psychologist', jobTitle: 'Psychologist', category: 'PSYCHOLOGIST' },
  { label: 'Optometrist', jobTitle: 'Optometrist', category: 'OPTOMETRIST' },
  { label: 'Technician', jobTitle: 'Technician', category: 'TECHNICIAN' },
  { label: 'Administrator', jobTitle: 'Administrator', category: 'ADMIN' },
  { label: 'Receptionist', jobTitle: 'Receptionist', category: 'RECEPTIONIST' },
  { label: 'Other', jobTitle: 'Other', category: 'OTHER' },
];

const INITIAL_DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

interface StaffRegistrationFormProps {
  departments: Department[];
  branches: Branch[];
  onCreated: (staffProfileId: string, message: string) => void;
}

export function cropStaffPhoto(file: File): Promise<File> {
  return createImageBitmap(file).then((image) => {
    const edge = Math.min(image.width, image.height);
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to prepare the profile photo.');
    context.drawImage(
      image,
      Math.floor((image.width - edge) / 2),
      Math.floor((image.height - edge) / 2),
      edge,
      edge,
      0,
      0,
      512,
      512,
    );
    image.close();
    return new Promise<File>((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(new File([blob], 'profile-photo.webp', { type: 'image/webp' }));
        else reject(new Error('Unable to prepare the profile photo.'));
      }, 'image/webp', 0.9);
    });
  });
}

export function StaffRegistrationForm({ departments, branches, onCreated }: StaffRegistrationFormProps) {
  const [services, setServices] = useState<Service[]>([]);
  const [step, setStep] = useState(0);
  const [fullName, setFullName] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [title, setTitle] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [days, setDays] = useState<string[]>(INITIAL_DAYS);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');
  const [acceptsOnlineBookings, setAcceptsOnlineBookings] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [bio, setBio] = useState('');
  const [languages, setLanguages] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [qualifications, setQualifications] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [licenseNumber, setLicenseNumber] = useState('');
  const [consultationFee, setConsultationFee] = useState('');
  const [gender, setGender] = useState('');
  const [telehealthEnabled, setTelehealthEnabled] = useState(false);
  const [professionalLinks, setProfessionalLinks] = useState('');
  const [loadingServices, setLoadingServices] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    let active = true;
    void getServices()
      .then((result) => { if (active) setServices(result.filter((service) => service.status === 'ACTIVE')); })
      .catch((requestError) => { if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load services.'); })
      .finally(() => { if (active) setLoadingServices(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!photo) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  const activeDepartments = departments.filter((department) => department.status === 'ACTIVE');
  const selectedDepartment = activeDepartments.find((department) => department.id === departmentId);
  const selectedTitle = TITLES.find((option) => option.label === title);
  const availableServices = services.filter((service) =>
    (!service.departmentId || service.departmentId === departmentId) &&
    (!service.branchId || service.branchId === branchId),
  );

  async function choosePhoto(file?: File) {
    setError(null);
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('Choose a JPG, PNG, or WEBP profile photo.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Profile photos must be 5 MB or smaller.');
      return;
    }
    try {
      setPhoto(await cropStaffPhoto(file));
    } catch (photoError) {
      setError(photoError instanceof Error ? photoError.message : 'Unable to prepare the profile photo.');
    }
  }

  function toggleService(serviceId: string) {
    setServiceIds((current) => current.includes(serviceId)
      ? current.filter((selected) => selected !== serviceId)
      : [...current, serviceId]);
  }

  function toggleDay(day: string) {
    setDays((current) => current.includes(day)
      ? current.filter((selected) => selected !== day)
      : [...current, day]);
  }

  function validateStep(): boolean {
    setError(null);
    if (step === 0) {
      if (!photo) { setError('A profile photo is required.'); return false; }
      if (fullName.trim().split(/\s+/).length < 2) { setError('Enter the staff member’s full name.'); return false; }
      if (!title) { setError('Select a professional title.'); return false; }
      if (title === 'Other' && !customTitle.trim()) { setError('Enter the professional title.'); return false; }
      if (!workEmail.trim() || !phone.trim() || !bio.trim() || !languages.trim()) {
        setError('Work email, phone, short bio, and at least one language are required.');
        return false;
      }
      return true;
    }
    if (!departmentId || !branchId) { setError('Select a department and branch.'); return false; }
    if (!serviceIds.length) { setError('Select at least one service this staff member provides.'); return false; }
    if (!days.length || !startTime || !endTime || endTime <= startTime) {
      setError('Choose at least one working day and a valid availability window.');
      return false;
    }
    if (acceptsOnlineBookings === '') { setError('Choose whether this staff member accepts online bookings.'); return false; }
    const links = professionalLinks.split(',').map((link) => link.trim()).filter(Boolean);
    if (links.some((link) => !/^https?:\/\//i.test(link))) {
      setError('Professional links must start with https:// or http://.');
      return false;
    }
    return true;
  }

  function continueStep() {
    if (!validateStep() || !formRef.current?.reportValidity()) return;
    setStep((current) => Math.min(current + 1, 2));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step < 2) { continueStep(); return; }
    if (!validateStep() || !photo || !selectedTitle) return;
    const nameParts = fullName.trim().split(/\s+/);
    const firstName = nameParts[0] ?? '';
    const lastName = nameParts.length > 1 ? nameParts.at(-1)! : firstName;
    const middleName = nameParts.length > 2 ? nameParts.slice(1, -1).join(' ') : undefined;

    setSaving(true);
    setError(null);
    try {
      const input: CreateStaffInput = {
        firstName,
        middleName,
        lastName,
        email: workEmail.trim(),
        phone: phone.trim(),
        gender: gender || undefined,
        departmentId,
        branchId,
        role: title === 'Other' ? customTitle.trim() : title,
        accessLevel: 'OPERATE',
        jobTitle: title === 'Other' ? customTitle.trim() : title,
        professionalCategory: selectedTitle.category,
        specialty: specialty.trim() || undefined,
        qualifications: qualifications.trim() || undefined,
        yearsExperience: yearsExperience ? Number(yearsExperience) : undefined,
        licenseNumber: licenseNumber.trim() || undefined,
        consultationFee: consultationFee ? Number(consultationFee) : undefined,
        telehealthEnabled,
        acceptsOnlineBookings: acceptsOnlineBookings === 'YES',
        professionalBio: bio.trim(),
        languages: languages.split(',').map((language) => language.trim()).filter(Boolean),
        professionalLinks: professionalLinks.split(',').map((link) => link.trim()).filter(Boolean),
        serviceIds,
        shiftName: 'Regular availability',
        shiftStartTime: startTime,
        shiftEndTime: endTime,
        shiftDays: days,
      };
      const created = await createStaff(input);
      let photoWarning = '';
      try {
        await uploadStaffDocument(created.id, 'PROFILE_PHOTO', photo);
      } catch {
        photoWarning = ' Profile photo upload failed; retry it in Verification & Documents.';
      }
      onCreated(
        created.id,
        `${created.invitationStatus === 'VERIFICATION_EMAIL_SENT' ? 'Staff profile added; email verification message sent' : 'Staff profile added; verification email could not be delivered'} for ${created.email}.${photoWarning}`,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to add this staff member.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="dashboard-card staff-wizard">
      <header className="dashboard-card-header"><div><h2>Add Staff</h2><p>Create a profile, assign services and availability, and set up secure account access.</p></div></header>
      <ol className="staff-wizard-steps staff-wizard-steps-three" aria-label="Staff registration steps">
        {['Profile', 'Work & booking', 'Review'].map((label, index) => <li key={label} className={index === step ? 'is-current' : index < step ? 'is-complete' : ''}><span>{index + 1}</span>{label}</li>)}
      </ol>
      {error && <div className="registration-error" role="alert">{error}</div>}
      <form ref={formRef} className="tenant-form" onSubmit={(event) => void submit(event)}>
        {step === 0 && <div className="staff-form-step">
          <h3>Profile</h3>
          <div className="staff-photo-field">
            {photoPreview ? <img src={photoPreview} alt="Profile photo preview" /> : <span aria-hidden="true">Photo</span>}
            <label>Profile photo (JPG, PNG, WEBP; max 5 MB)<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void choosePhoto(event.target.files?.[0])} /></label>
            {photo && <button type="button" className="dashboard-secondary-button" onClick={() => setPhoto(null)}>Remove photo</button>}
          </div>
          <div className="tenant-form-grid">
            <label className="staff-field-wide">Full name<input required autoComplete="name" maxLength={300} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
            <label>Professional title<select required value={title} onChange={(event) => setTitle(event.target.value)}><option value="">Select title</option>{TITLES.map((option) => <option key={option.label} value={option.label}>{option.label}</option>)}</select></label>
            {title === 'Other' && <label>Professional title<input required maxLength={150} value={customTitle} onChange={(event) => setCustomTitle(event.target.value)} placeholder="Enter title" /></label>}
            <label>Work email<input required type="email" autoComplete="email" maxLength={320} value={workEmail} onChange={(event) => setWorkEmail(event.target.value)} /></label>
            <label>Phone number<input required type="tel" autoComplete="tel" minLength={7} maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} /></label>
            <label>Short bio<textarea required rows={3} maxLength={4000} value={bio} onChange={(event) => setBio(event.target.value)} /></label>
            <label>Languages spoken<input required placeholder="English, French" value={languages} onChange={(event) => setLanguages(event.target.value)} /></label>
            <label>Gender<select value={gender} onChange={(event) => setGender(event.target.value)}><option value="">Not specified</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="NON_BINARY">Non-binary</option><option value="PREFER_NOT_TO_SAY">Prefer not to say</option><option value="OTHER">Other</option></select></label>
          </div>
        </div>}

        {step === 1 && <div className="staff-form-step">
          <h3>Department, services & availability</h3>
          <div className="tenant-form-grid">
            <label>Department<select required value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setServiceIds([]); }}><option value="">Select department</option>{activeDepartments.map((department) => <option key={department.id} value={department.id}>{department.name}</option>)}</select></label>
            <label>Branch<select required value={branchId} onChange={(event) => { setBranchId(event.target.value); setServiceIds([]); }}><option value="">Select branch</option>{branches.filter((branch) => branch.status === 'ACTIVE').map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>
          </div>
          <fieldset className="staff-assignment-editor">
            <legend>Services provided</legend>
            {loadingServices ? <p>Loading services…</p> : availableServices.length ? <div className="staff-service-grid">{availableServices.map((service) => <label className="staff-service-option" key={service.id}><input type="checkbox" checked={serviceIds.includes(service.id)} onChange={() => toggleService(service.id)} /><span><strong>{service.name}</strong><small>{service.department?.name ?? 'Organization service'}{service.durationMin ? ` · ${service.durationMin} min` : ''}</small></span></label>)}</div> : <p>{departmentId ? 'No active services match this department and branch.' : 'Select a department and branch to see services.'}</p>}
          </fieldset>
          <fieldset className="staff-assignment-editor">
            <legend>Calendar / availability</legend>
            <div className="staff-day-picker">{DAYS.map(([day, label]) => <label className={days.includes(day) ? 'is-selected' : ''} key={day}><input type="checkbox" checked={days.includes(day)} onChange={() => toggleDay(day)} />{label}</label>)}</div>
            <div className="tenant-form-grid staff-time-range"><label>Available from<input required type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label><label>Available until<input required type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label></div>
          </fieldset>
          <div className="tenant-form-grid">
            <label>Accepts online bookings<select required value={acceptsOnlineBookings} onChange={(event) => setAcceptsOnlineBookings(event.target.value)}><option value="">Select</option><option value="YES">Yes</option><option value="NO">No</option></select></label>
            <label>Specialty<input maxLength={200} value={specialty} onChange={(event) => setSpecialty(event.target.value)} /></label>
            <label>Qualifications<input maxLength={1000} value={qualifications} onChange={(event) => setQualifications(event.target.value)} /></label>
            <label>Years of experience<input type="number" min={0} max={80} value={yearsExperience} onChange={(event) => setYearsExperience(event.target.value)} /></label>
            <label>License number<input maxLength={150} value={licenseNumber} onChange={(event) => setLicenseNumber(event.target.value)} /></label>
            <label>Consultation fee<input type="number" min={0} step="0.01" value={consultationFee} onChange={(event) => setConsultationFee(event.target.value)} /></label>
            <label className="staff-toggle"><input type="checkbox" checked={telehealthEnabled} onChange={(event) => setTelehealthEnabled(event.target.checked)} />Telehealth enabled</label>
            <label className="staff-field-wide">Instagram / LinkedIn / professional links<input placeholder="https://… , https://…" value={professionalLinks} onChange={(event) => setProfessionalLinks(event.target.value)} /></label>
          </div>
        </div>}

        {step === 2 && <div className="staff-form-step staff-invitation-summary">
          <h3>Review & add</h3>
          <p>A secure account setup email is sent after the profile is created. Staff set their own password.</p>
          <div className="staff-summary-line"><span>Staff member</span><strong>{fullName}</strong></div>
          <div className="staff-summary-line"><span>Professional title</span><strong>{title === 'Other' ? customTitle : selectedTitle?.label}</strong></div>
          <div className="staff-summary-line"><span>Department / branch</span><strong>{selectedDepartment?.name} · {branches.find((branch) => branch.id === branchId)?.name}</strong></div>
          <div className="staff-summary-line"><span>Services</span><strong>{availableServices.filter((service) => serviceIds.includes(service.id)).map((service) => service.name).join(', ')}</strong></div>
          <div className="staff-summary-line"><span>Availability</span><strong>{days.map((day) => DAYS.find(([key]) => key === day)?.[1]).join(', ')} · {startTime}–{endTime}</strong></div>
          <div className="staff-summary-line"><span>Online bookings</span><strong>{acceptsOnlineBookings === 'YES' ? 'Yes' : 'No'}</strong></div>
        </div>}

        <footer className="staff-wizard-actions">
          <button type="button" className="dashboard-secondary-button" disabled={step === 0 || saving} onClick={() => setStep((current) => current - 1)}>Back</button>
          {step < 2 ? <button type="button" className="dashboard-primary-button" onClick={continueStep}>Continue</button> : 

    
        <button type="submit" className="dashboard-primary-button" disabled={saving || !activeDepartments.length}>{saving ? 'Adding staff…' : 'Add staff member'}</button>}
        </footer>
      </form>
    </section>
  );
}