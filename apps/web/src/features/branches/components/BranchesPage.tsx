import { FormEvent, useEffect, useState } from 'react';
import {
  createBranch,
  deactivateBranch,
  getBranches,
  updateBranch,
} from '../api/branches.api.js';
import type {
  Branch,
  CreateBranchInput,
} from '../types/branch.types.js';

interface BranchesPageProps {
  onNavigate?: (path: string) => void;
}

interface BranchFormState {
  name: string;
  code: string;
  address: string;
  town: string;
  county: string;
  postalCode: string;
  latitude: string;
  longitude: string;
  contactPhone: string;
  contactEmail: string;
  openingTime: string;
  closingTime: string;
  operatingDays: string[];
}

const emptyForm: BranchFormState = {
  name: '',
  code: '',
  address: '',
  town: '',
  county: '',
  postalCode: '',
  latitude: '',
  longitude: '',
  contactPhone: '',
  contactEmail: '',
  openingTime: '',
  closingTime: '',
  operatingDays: [],
};

export function BranchesPage({
  onNavigate,
}: BranchesPageProps) {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] =
    useState<BranchFormState>(emptyForm);
  const [editingBranch, setEditingBranch] =
    useState<Branch | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deactivatingId, setDeactivatingId] =
    useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function loadBranches(): Promise<void> {
    setLoading(true);
    setError(null);

    try {
      const result = await getBranches();
      setBranches(result);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load branches.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBranches();
  }, []);

  function resetForm(): void {
    setEditingBranch(null);
    setForm(emptyForm);
  }

  function beginEdit(branch: Branch): void {
    setEditingBranch(branch);
    setForm({
      name: branch.name,
      code: branch.code,
      address: branch.address ?? '',
      town: branch.town ?? '',
      county: branch.county ?? '',
      postalCode: branch.postalCode ?? '',
      latitude: branch.latitude == null ? '' : String(branch.latitude),
      longitude: branch.longitude == null ? '' : String(branch.longitude),
      contactPhone: branch.contactPhone ?? '',
      contactEmail: branch.contactEmail ?? '',
      openingTime: branch.openingTime ?? '',
      closingTime: branch.closingTime ?? '',
      operatingDays: branch.operatingDays ?? [],
    });
    setError(null);
    setSuccess(null);
  }

  function updateField(
    field: keyof BranchFormState,
    value: string,
  ): void {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
    setError(null);
    setSuccess(null);
  }

  function toggleOperatingDay(day: string): void {
    setForm((current) => ({
      ...current,
      operatingDays: current.operatingDays.includes(day)
        ? current.operatingDays.filter((item) => item !== day)
        : [...current.operatingDays, day],
    }));
    setError(null);
    setSuccess(null);
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();

    const name = form.name.trim();
    const code = form.code.trim().toUpperCase();

    if (name.length < 2 || code.length < 2) {
      setError(
        'Branch name and code are required.',
      );
      return;
    }
    const latitude = form.latitude.trim() ? Number(form.latitude) : undefined;
    const longitude = form.longitude.trim() ? Number(form.longitude) : undefined;
    if ((latitude === undefined) !== (longitude === undefined) ||
      (latitude !== undefined && (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)) ||
      (longitude !== undefined && (!Number.isFinite(longitude) || longitude < -180 || longitude > 180))) {
      setError('Enter both valid coordinates, or leave both blank.');
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      if (editingBranch) {
        await updateBranch(editingBranch.id, {
          name,
          code,
          address: form.address.trim() || null,
          town: form.town.trim() || null,
          county: form.county.trim() || null,
          postalCode: form.postalCode.trim() || null,
          latitude: latitude ?? null,
          longitude: longitude ?? null,
          contactPhone: form.contactPhone.trim() || null,
          contactEmail: form.contactEmail.trim() || null,
          openingTime: form.openingTime || null,
          closingTime: form.closingTime || null,
          operatingDays: form.operatingDays,
        });

        setSuccess(
          'Branch information updated successfully.',
        );
      } else {
        const input: CreateBranchInput = {
          name,
          code,
          address: form.address.trim() || undefined,
          town: form.town.trim() || undefined,
          county: form.county.trim() || undefined,
          postalCode: form.postalCode.trim() || undefined,
          ...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
          contactPhone: form.contactPhone.trim() || undefined,
          contactEmail: form.contactEmail.trim() || undefined,
          openingTime: form.openingTime || undefined,
          closingTime: form.closingTime || undefined,
          operatingDays: form.operatingDays,
        };

        await createBranch(input);

        setSuccess(
          'Branch created successfully.',
        );
      }

      resetForm();
      await loadBranches();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to save branch.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(
    branch: Branch,
  ): Promise<void> {
    const confirmed = window.confirm(
      `Deactivate "${branch.name}"? This branch will no longer be available for active operations.`,
    );

    if (!confirmed) {
      return;
    }

    setDeactivatingId(branch.id);
    setError(null);
    setSuccess(null);

    try {
      await deactivateBranch(branch.id);

      if (editingBranch?.id === branch.id) {
        resetForm();
      }

      setSuccess(
        'Branch deactivated successfully.',
      );

      await loadBranches();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to deactivate branch.',
      );
    } finally {
      setDeactivatingId(null);
    }
  }

  if (loading) {
    return (
      <section className="tenant-module-page">
        <div className="tenant-dashboard-loading">
          <p>Loading branches...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="tenant-module-page">
      <header className="tenant-module-header">
        <div>
          <p className="dashboard-eyebrow">
            Organization
          </p>
          <h1>Branches</h1>
          <p>
            Manage the physical and operational branches
            belonging to your organization.
          </p>
        </div>

        <div className="tenant-module-meta">
          <strong>
            {branches.length}{' '}
            {branches.length === 1
              ? 'active branch'
              : 'active branches'}
          </strong>
        </div>
      </header>

      {error && (
        <div className="tenant-form-alert tenant-form-alert-error">
          {error}
        </div>
      )}

      {success && (
        <div className="tenant-form-alert tenant-form-alert-success">
          {success}
        </div>
      )}

      <div className="branches-layout">
        <div className="dashboard-card">
          <div className="card-heading">
            <div>
              <p className="dashboard-card-label">
                {editingBranch ? 'Edit branch' : 'New branch'}
              </p>
              <h2>
                {editingBranch
                  ? 'Update branch'
                  : 'Create branch'}
              </h2>
            </div>
          </div>

          <form
            className="tenant-organization-form"
            onSubmit={(event) =>
              void handleSubmit(event)
            }
          >
            <div className="tenant-form-grid">
              <label>
                <span>Branch name</span>
                <input
                  value={form.name}
                  onChange={(event) =>
                    updateField(
                      'name',
                      event.target.value,
                    )
                  }
                  required
                  minLength={2}
                  maxLength={200}
                  placeholder="Main Hospital"
                />
              </label>

              <label>
                <span>Branch code</span>
                <input
                  value={form.code}
                  onChange={(event) =>
                    updateField(
                      'code',
                      event.target.value,
                    )
                  }
                  required
                  minLength={2}
                  maxLength={50}
                  placeholder="MAIN"
                />
              </label>

              <label>
                <span>Physical address</span>
                <input value={form.address} onChange={(event) => updateField('address', event.target.value)} maxLength={1000} placeholder="Street, building or landmark" />
              </label>
              <label>
                <span>Town / City</span>
                <input value={form.town} onChange={(event) => updateField('town', event.target.value)} maxLength={150} placeholder="Nairobi" />
              </label>
              <label>
                <span>County</span>
                <input value={form.county} onChange={(event) => updateField('county', event.target.value)} maxLength={150} placeholder="Nairobi County" />
              </label>
              <label>
                <span>Postal code</span>
                <input value={form.postalCode} onChange={(event) => updateField('postalCode', event.target.value)} maxLength={30} placeholder="00100" />
              </label>
              <label>
                <span>Branch latitude</span>
                <input type="number" step="0.000001" min="-90" max="90" value={form.latitude} onChange={(event) => updateField('latitude', event.target.value)} placeholder="-1.286389" />
              </label>
              <label>
                <span>Branch longitude</span>
                <input type="number" step="0.000001" min="-180" max="180" value={form.longitude} onChange={(event) => updateField('longitude', event.target.value)} placeholder="36.817223" />
              </label>
              <label>
                <span>Contact phone</span>
                <input type="tel" value={form.contactPhone} onChange={(event) => updateField('contactPhone', event.target.value)} maxLength={50} placeholder="+254 7..." />
              </label>
              <label>
                <span>Contact email</span>
                <input type="email" value={form.contactEmail} onChange={(event) => updateField('contactEmail', event.target.value)} maxLength={254} placeholder="branch@example.com" />
              </label>
              <label>
                <span>Opening time</span>
                <input type="time" value={form.openingTime} onChange={(event) => updateField('openingTime', event.target.value)} />
              </label>
              <label>
                <span>Closing time</span>
                <input type="time" value={form.closingTime} onChange={(event) => updateField('closingTime', event.target.value)} />
              </label>
            </div>

            <fieldset className="branches-operating-days">
              <legend>Operating days</legend>
              <div className="tenant-form-grid">
                {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((day) => (
                  <label key={day}>
                    <input
                      type="checkbox"
                      checked={form.operatingDays.includes(day)}
                      onChange={() => toggleOperatingDay(day)}
                    />
                    <span>{day}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="branches-form-actions">
              <button
                type="submit"
                className="dashboard-primary-button"
                disabled={saving}
              >
                {saving
                  ? 'Saving...'
                  : editingBranch
                    ? 'Save changes'
                    : 'Create branch'}
              </button>

              {editingBranch && (
                <button
                  type="button"
                  className="dashboard-secondary-button"
                  onClick={resetForm}
                  disabled={saving}
                >
                  Cancel
                </button>
              )}
            </div>
          </form>
        </div>

        <div className="dashboard-card">
          <div className="card-heading">
            <div>
              <p className="dashboard-card-label">
                Active branches
              </p>
              <h2>Branch directory</h2>
            </div>
          </div>

          {branches.length === 0 ? (
            <div className="branches-empty-state">
              <h3>No branches configured</h3>
              <p>
                Create your first branch to begin
                configuring the organization's operational
                structure.
              </p>
            </div>
          ) : (
            <div className="branches-list">
              {branches.map((branch) => (
                <article
                  className="branch-list-item"
                  key={branch.id}
                >
                  <div className="branch-list-main">
                    <div>
                      <h3>{branch.name}</h3>
                      <p>
                        Code: <strong>{branch.code}</strong>
                      </p>
                    </div>

                    <span className="branch-status">
                      {branch.status}
                    </span>
                  </div>

                  <div className="branch-list-meta">
                    <span>
                      Departments:{' '}
                      {branch._count?.departments ?? 0}
                    </span>
                    <span>
                      Members:{' '}
                      {branch._count?.memberships ?? 0}
                    </span>
                    <span>
                      Services:{' '}
                      {branch._count?.services ?? 0}
                    </span>
                  </div>

                  {(branch.address ||
                    branch.town ||
                    branch.county ||
                    branch.postalCode ||
                    branch.contactPhone ||
                    branch.contactEmail ||
                    branch.openingTime ||
                    branch.closingTime ||
                    branch.operatingDays?.length) && (
                    <div className="branch-details">
                      {(branch.address ||
                        branch.town ||
                        branch.county ||
                        branch.postalCode) && (
                        <p>
                          <strong>Location:</strong>{' '}
                          {[
                            branch.address,
                            branch.town,
                            branch.county,
                            branch.postalCode,
                          ]
                            .filter(Boolean)
                            .join(', ')}
                        </p>
                      )}

                      {branch.contactPhone && (
                        <p>
                          <strong>Phone:</strong>{' '}
                          <a href={`tel:${branch.contactPhone}`}>
                            {branch.contactPhone}
                          </a>
                        </p>
                      )}

                      {branch.contactEmail && (
                        <p>
                          <strong>Email:</strong>{' '}
                          <a href={`mailto:${branch.contactEmail}`}>
                            {branch.contactEmail}
                          </a>
                        </p>
                      )}

                      {(branch.openingTime || branch.closingTime) && (
                        <p>
                          <strong>Hours:</strong>{' '}
                          {branch.openingTime || 'Not set'}
                          {' – '}
                          {branch.closingTime || 'Not set'}
                        </p>
                      )}

                      {branch.operatingDays?.length > 0 && (
                        <p>
                          <strong>Operating days:</strong>{' '}
                          {branch.operatingDays.join(', ')}
                        </p>
                      )}
                    </div>
                  )}

                  {branch.organization && (
                    <p className="branch-organization">
                      Organization:{' '}
                      <strong>
                        {branch.organization.name}
                      </strong>
                    </p>
                  )}

                  <div className="branch-list-actions">
                    <button
                      type="button"
                      className="dashboard-secondary-button"
                      onClick={() =>
                        beginEdit(branch)
                      }
                    >
                      Edit
                    </button>

                    <button
                      type="button"
                      className="dashboard-danger-button"
                      onClick={() =>
                        void handleDeactivate(branch)
                      }
                      disabled={
                        deactivatingId === branch.id
                      }
                    >
                      {deactivatingId === branch.id
                        ? 'Deactivating...'
                        : 'Deactivate'}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="branches-footer-actions">
        <button
          type="button"
          className="dashboard-secondary-button"
          onClick={() =>
            onNavigate?.('/tenant/organization')
          }
        >
          Back to organization
        </button>

        <button
          type="button"
          className="dashboard-secondary-button"
          onClick={() =>
            onNavigate?.('/tenant/departments')
          }
        >
          Continue to departments
        </button>
      </div>
    </section>
  );
}
