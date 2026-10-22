import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Building2,
  CalendarDays,
  ClipboardList,
  FileText,
  FlaskConical,
  KeyRound,
  Pill,
  Eye,
  Search,
  X,
  ShieldCheck,
  UserRound,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import {
  approvePatientRelationshipRequest,
  declinePatientRelationshipRequest,
  getMyPatientDashboard,
  getMyPatientJourney,
  getMyCareHistory,
  viewMyCareAttachment,
} from '../api/patient-dashboard.api.js';
import {
  acknowledgeMyQueueCall,
  deleteMyNotification,
  deleteWebPushSubscription,
  getWebPushPublicKey,
  getMyNotifications,
  markNotificationAsRead,
  saveWebPushSubscription,
} from '../../notifications/api/notifications.api.js';
import { QueueCallAlert } from '../../notifications/components/QueueCallAlert.js';
import { PatientNotificationBell } from '../../notifications/components/PatientNotificationBell.js';
import { NotificationInboxPanel } from '../../notifications/components/NotificationInboxPanel.js';
import { enableNotificationSound, playNotificationSound } from '../../notifications/utils/notification-sound.js';
import type {
  PatientDashboardResponse,
  PatientJourney,
  PatientJourneyResponse,
  CareHistoryAttachment,
  CareHistoryItem,
  CareHistoryResponse,
  PatientRelationshipRequest,
} from '../types/patient-dashboard.types.js';
import {
  getFamilyRelationships,
  getFamilyRequests,
} from '../../patient-family/api/patient-family.api.js';
import { PatientAppointmentsSection } from '../components/PatientAppointmentsSection.js';
import { PatientShopPage } from '../../shop/components/PatientShopPage.js';
import './PatientDashboardPage.css';

interface PatientDashboardPageProps {
  onNavigate: (path: string) => void;
  onLogout: () => void;
}

const facilityTypeLabels: Record<string, string> = {
  HOSPITAL: 'Hospital',
  CLINIC: 'Clinic',
  SPECIALIST_PRACTICE: 'Specialist Practice',
  MEDICAL_CENTER: 'Medical Center',
  DIAGNOSTIC_CENTER: 'Diagnostic Center',
  LABORATORY: 'Laboratory',
  RADIOLOGY_CENTER: 'Radiology Center',
  PHARMACY: 'Pharmacy',
  DENTAL_CLINIC: 'Dental Clinic',
  OPTICAL_CENTER: 'Optical Center',
  MATERNITY_CENTER: 'Maternity Center',
  REHABILITATION_CENTER: 'Rehabilitation',
  HOME_HEALTH_PROVIDER: 'Home Health Provider',
  AMBULANCE_PROVIDER: 'Ambulance Provider',
  HEALTHCARE_NETWORK: 'Healthcare Network',
  CORPORATE_HEALTH_PROVIDER: 'Corporate Health Provider',
  INSURER: 'Insurer',
  EXTERNAL_PROVIDER: 'External Provider',
  OTHER_HEALTHCARE_PROVIDER: 'Healthcare Provider',
};

const unavailablePatientSections: Record<string, { title: string; detail: string }> = {
  '/patient/appointments': {
    title: 'Appointments',
    detail: 'Appointment records are not connected to the patient account yet.',
  },
  '/patient/laboratory': {
    title: 'Laboratory',
    detail: 'Laboratory results are not connected to the patient account yet.',
  },
  '/patient/prescriptions': {
    title: 'Prescriptions',
    detail: 'Prescription records are not connected to the patient account yet.',
  },
  '/patient/documents': {
    title: 'Documents',
    detail: 'Patient documents are not connected to the patient account yet.',
  },
  '/patient/access': {
    title: 'Data access',
    detail: 'Data access activity is not connected to the patient account yet.',
  },
};

function getFacilityType(type: string): string {
  return facilityTypeLabels[type] ?? 'Healthcare Provider';
}

function decodePushKey(key: string): ArrayBuffer {
  const padding = '='.repeat((4 - (key.length % 4)) % 4);
  const base64 = `${key}${padding}`.replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return buffer;
}

function getRelationshipLabel(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return 'Active relationship';
    case 'PENDING':
      return 'Pending';
    case 'INACTIVE':
      return 'Inactive';
    case 'SUSPENDED':
      return 'Suspended';
    case 'ARCHIVED':
      return 'Archived';
    default:
      return status;
  }
}

function RelationshipRequestCard({
  request,
  busyRequestId,
  onApprove,
  onDecline,
}: {
  request: PatientRelationshipRequest;
  busyRequestId: string | null;
  onApprove: (requestId: string) => void;
  onDecline: (requestId: string) => void;
}) {
  const busy = busyRequestId === request.id;

  return (
    <article className="patient-dashboard-request-card">
      <div>
        <p className="patient-dashboard-eyebrow">
          Facility relationship request
        </p>
        <h3>{request.facility.name}</h3>
        <p>
          {getFacilityType(request.facility.type)}
          {' · '}
          Patient number {request.patientRecord.patientNumber}
        </p>

        {request.reason ? (
          <p className="patient-dashboard-request-reason">
            {request.reason}
          </p>
        ) : null}
      </div>

      <div className="patient-dashboard-request-actions">
        <button
          type="button"
          className="patient-dashboard-button"
          disabled={busy}
          onClick={() => onApprove(request.id)}
        >
          {busy ? 'Processing...' : 'Allow facility'}
        </button>

        <button
          type="button"
          className="patient-dashboard-button secondary"
          disabled={busy}
          onClick={() => onDecline(request.id)}
        >
          Decline
        </button>
      </div>
    </article>
  );
}

function PatientOverviewCard({
  title,
  metric,
  summary,
  path,
  tone,
  icon: Icon,
  onNavigate,
}: {
  title: string;
  metric: string;
  summary: string;
  path: string;
  tone: string;
  icon: LucideIcon;
  onNavigate: (path: string) => void;
}) {
  return (
    <button
      type="button"
      className={`patient-overview-card patient-overview-card-${tone}`}
      onClick={() => onNavigate(path)}
    >
      <span className="patient-overview-card-icon" aria-hidden="true">
        <Icon size={21} strokeWidth={1.8} />
      </span>
      <span className="patient-overview-card-title">{title}</span>
      <strong className="patient-overview-card-metric">{metric}</strong>
      <span className="patient-overview-card-summary">{summary}</span>
      <span className="patient-overview-card-action">
        Open section <ArrowUpRight size={16} aria-hidden="true" />
      </span>
    </button>
  );
}

const patientNavigationItems = [
  { label: 'Overview', path: '/patient/dashboard', icon: 'OV' },
  { label: 'Care journey', path: '/patient/journey', icon: 'CJ' },
  { label: 'My profile', path: '/patient/profile', icon: 'PR' },
  { label: 'Family', path: '/patient/family', icon: 'FM' },
  { label: 'Facilities', path: '/patient/facilities', icon: 'FC' },
  { label: 'Requests', path: '/patient/requests', icon: 'RQ' },
  { label: 'Appointments', path: '/patient/appointments', icon: 'AP' },
  { label: 'Care history', path: '/patient/encounters', icon: 'CH' },
  { label: 'Laboratory', path: '/patient/laboratory', icon: 'LB' },
  { label: 'Prescriptions', path: '/patient/prescriptions', icon: 'RX' },
  { label: 'Medical shop', path: '/patient/shop', icon: 'SH' },
  { label: 'Documents', path: '/patient/documents', icon: 'DC' },
  { label: 'Data access', path: '/patient/access', icon: 'DA' },
] as const;

function PatientSidebar({
  collapsed,
  currentPath,
  patientName,
  onToggle,
  onNavigate,
  onLogout,
}: {
  collapsed: boolean;
  currentPath: string;
  patientName: string;
  onToggle: () => void;
  onNavigate: (path: string) => void;
  onLogout: () => void;
}) {
  const overviewActive =
    currentPath === '/patient' || currentPath === '/patient/dashboard';

  return (
    <aside className={`patient-sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="patient-sidebar-brand">
        <div className="patient-brand-mark">R</div>
        <div className="patient-sidebar-brand-copy">
          <strong>REVALTRIX</strong>
          <span>Patient</span>
        </div>
        <button
          type="button"
          className="patient-sidebar-toggle"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          onClick={onToggle}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>
      <nav className="patient-sidebar-navigation" aria-label="Patient navigation">
        {patientNavigationItems.map((item) => {
          const active = item.path === '/patient/dashboard'
            ? overviewActive
            : currentPath === item.path;

          return (
            <button
              type="button"
              key={item.path}
              title={item.label}
              aria-label={item.label}
              aria-current={active ? 'page' : undefined}
              className={`patient-nav-item ${active ? 'active' : ''}`}
              onClick={() => onNavigate(item.path)}
            >
              <span className="patient-nav-icon" aria-hidden="true">{item.icon}</span>
              <span className="patient-nav-label">{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="patient-sidebar-footer">
        <div className="patient-user-summary">
          <strong>{patientName}</strong>
          <span>Revaltrix Patient</span>
        </div>
        <button
          type="button"
          className="patient-logout-button"
          title="Sign out"
          aria-label="Sign out"
          onClick={onLogout}
        >
          <span className="patient-nav-icon" aria-hidden="true">↪</span>
          <span className="patient-nav-label">Sign out</span>
        </button>
      </div>
    </aside>
  );
}

export function PatientDashboardPage({
  onNavigate,
  onLogout,
}: PatientDashboardPageProps) {
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/';
  const isOverviewContent =
    currentPath === '/patient' || currentPath === '/patient/dashboard';
  const [dashboard, setDashboard] =
    useState<PatientDashboardResponse | null>(null);
  const [journey, setJourney] =
    useState<PatientJourneyResponse | null>(null);
  const [careHistory, setCareHistory] =
    useState<CareHistoryResponse | null>(null);
  const [familySummary, setFamilySummary] = useState<{
    activeRelationships: number;
    pendingRequests: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyRequestId, setBusyRequestId] = useState<string | null>(null);

  const [notifications, setNotifications] = useState<
    Awaited<ReturnType<typeof getMyNotifications>>
  >([]);
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushError, setPushError] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [showNotificationInbox, setShowNotificationInbox] = useState(false);
  const [deletingNotificationId, setDeletingNotificationId] = useState<string | null>(null);
  const [notificationActionError, setNotificationActionError] = useState<string | null>(null);
  const [queueCallBusy, setQueueCallBusy] = useState(false);
  const [queueCallError, setQueueCallError] = useState<string | null>(null);
  const [showQueueDetails, setShowQueueDetails] = useState(false);
  const [showJourneyDetails, setShowJourneyDetails] = useState(false);
  const [showCareHistory, setShowCareHistory] = useState(false);
  const [journeySearch, setJourneySearch] = useState('');
  const [careHistorySearch, setCareHistorySearch] = useState('');
  const [viewingAttachmentId, setViewingAttachmentId] = useState<string | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<{
    url: string;
    fileName: string;
    contentType: string;
  } | null>(null);
  const selectedJourneyId = new URLSearchParams(window.location.search).get('journeyId');

  useEffect(() => {
    return () => {
      if (attachmentPreview) {
        URL.revokeObjectURL(attachmentPreview.url);
      }
    };
  }, [attachmentPreview]);

  const journeyFacilityGroups = journey?.data.reduce(
    (groups, item) => {
      const facility = item.journey.facility;
      const group = groups.find((candidate) => candidate.facility.id === facility.id);
      if (group) {
        group.journeys.push(item);
      } else {
        groups.push({ facility, journeys: [item] });
      }
      return groups;
    },
    [] as Array<{
      facility: PatientJourney['journey']['facility'];
      journeys: PatientJourney[];
    }>,
  ) ?? [];

  const filteredJourneyFacilityGroups = journeyFacilityGroups
    .map((group) => ({
      ...group,
      journeys: group.journeys.filter((item) => {
        const search = journeySearch.trim().toLowerCase();
        if (!search) return true;
        return [
          group.facility.name,
          group.facility.legalName ?? '',
          item.journey.status,
          item.journey.startedAt,
          ...item.steps.flatMap((step) => [
            step.name,
            step.department?.name ?? '',
            step.branch?.name ?? '',
            step.queueEntry?.status ?? '',
          ]),
        ].some((value) => value.toLowerCase().includes(search));
      }),
    }))
    .filter((group) => group.journeys.length > 0);

  const careHistoryFacilityGroups = careHistory?.data.reduce(
    (groups, visit) => {
      const group = groups.find((candidate) => candidate.facility.code === visit.facility.code);
      if (group) {
        group.visits.push(visit);
      } else {
        groups.push({ facility: visit.facility, visits: [visit] });
      }
      return groups;
    },
    [] as Array<{
      facility: CareHistoryItem['facility'];
      visits: CareHistoryItem[];
    }>,
  ) ?? [];

  const filteredCareHistoryFacilityGroups = careHistoryFacilityGroups
    .map((group) => ({
      ...group,
      visits: group.visits.filter((visit) => {
        const search = careHistorySearch.trim().toLowerCase();
        if (!search) return true;
        return [
          group.facility.name,
          group.facility.legalName ?? '',
          visit.status,
          visit.date,
          ...visit.departments.flatMap((department) => [
            department.name,
            department.department?.name ?? '',
            department.branch?.name ?? '',
            ...department.care.flatMap((record) => [record.note ?? '', record.procedures ?? '']),
          ]),
          ...visit.clinicalNotes.flatMap((note) => [
            note.chiefComplaint ?? '',
            note.assessment ?? '',
            note.plan ?? '',
          ]),
        ].some((value) => value.toLowerCase().includes(search));
      }),
    }))
    .filter((group) => group.visits.length > 0);

  const activeJourneys =
    journey?.data?.filter(
      (item) =>
        item.journey.status === 'ACTIVE' &&
        item.current !== null &&
        !['COMPLETED', 'CANCELLED'].includes(item.current.status),
    ) ?? [];

  const completedJourneys =
    journey?.data?.filter(
      (item) =>
        item.journey.status === 'COMPLETED' ||
        item.current?.status === 'COMPLETED',
    ) ?? [];

  const currentJourney =
    activeJourneys.find(
      (item) => item.current?.queueEntry?.status === 'CALLED',
    ) ??
    activeJourneys.find(
      (item) => item.current?.queueEntry?.status === 'IN_SERVICE',
    ) ??
    activeJourneys.find(
      (item) => item.current?.queueEntry?.status === 'WAITING',
    ) ??
    activeJourneys.find(
      (item) => item.current?.queueEntry?.status === 'CREATED',
    ) ??
    activeJourneys[0] ??
    null;


  async function loadJourney(): Promise<void> {
    try {
      const response = await getMyPatientJourney();
      setJourney(response);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to refresh your care journey.',
      );
    }
  }

  async function loadCareHistory(): Promise<void> {
    try {
      const response = await getMyCareHistory();
      setCareHistory(response);
    } catch {
      // Keep the main dashboard usable if history temporarily fails.
    }
  }

  async function openCareAttachment(attachment: CareHistoryAttachment): Promise<void> {
    setViewingAttachmentId(attachment.id);
    setError(null);

    try {
      const file = await viewMyCareAttachment(attachment.id);
      setAttachmentPreview({
        url: URL.createObjectURL(file),
        fileName: attachment.fileName,
        contentType: attachment.contentType,
      });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to view this file.',
      );
    } finally {
      setViewingAttachmentId(null);
    }
  }

  async function loadFamilySummary(): Promise<void> {
    try {
      const [relationships, requests] = await Promise.all([
        getFamilyRelationships(),
        getFamilyRequests(),
      ]);
      setFamilySummary({
        activeRelationships: relationships.data.filter(
          (relationship) => relationship.status === 'ACTIVE',
        ).length,
        pendingRequests: requests.data.filter(
          (request) => request.status === 'PENDING',
        ).length,
      });
    } catch {
      setFamilySummary(null);
    }
  }

  async function loadNotifications(): Promise<void> {
    try {
      const nextNotifications = await getMyNotifications(false);
      setNotifications(nextNotifications);
    } catch {
      // Notification availability must not break the patient dashboard.
    }
  }

  async function loadDashboard(
    showLoading = true,
    loadRelatedContent = true,
  ): Promise<void> {
    if (showLoading) {
      setLoading(true);
    }
    setError(null);

    try {
      const response = await getMyPatientDashboard();
      setDashboard(response);
      if (loadRelatedContent) {
        await Promise.all([
          loadJourney(),
          loadCareHistory(),
          loadFamilySummary(),
        ]);
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to load your patient dashboard.',
      );
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }

  async function refreshOpenContent(): Promise<void> {
    setRefreshing(true);
    setError(null);

    try {
      if (isOverviewContent) {
        const [dashboardResponse, journeyResponse, careHistoryResponse] = await Promise.all([
          getMyPatientDashboard(),
          getMyPatientJourney(),
          getMyCareHistory(),
        ]);
        setDashboard(dashboardResponse);
        setJourney(journeyResponse);
        setCareHistory(careHistoryResponse);
        await loadFamilySummary();
      } else if (currentPath === '/patient/encounters') {
        setCareHistory(await getMyCareHistory());
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to refresh this section.',
      );
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadDashboard();
    void loadNotifications();
    void navigator.serviceWorker?.getRegistration().then(async (registration) => {
      const subscription = await registration?.pushManager.getSubscription();
      setPushEnabled(subscription !== null && subscription !== undefined);
    });

    const interval = window.setInterval(() => {
      void loadJourney();
      void loadNotifications();
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, []);

  async function enableSound(): Promise<void> {
    try {
      await enableNotificationSound();
      setSoundEnabled(true);
    } catch {
      setSoundEnabled(false);
    }
  }

  const queueCallNotification =
    notifications.find(
      (notification) =>
        notification.type === 'QUEUE_PATIENT_CALLED' &&
        notification.readAt === null,
    ) ?? null;
  const referralNotification =
    notifications.find(
      (notification) =>
        notification.type === 'PATIENT_DEPARTMENT_REFERRED' &&
        notification.readAt === null,
    ) ?? null;

  const unreadCount = notifications.filter(
    (notification) => notification.readAt === null,
  ).length;

  useEffect(() => {
    const alertNotification = queueCallNotification ?? referralNotification;

    if (!alertNotification || !soundEnabled) {
      return;
    }

    void playNotificationSound();
  }, [queueCallNotification?.id, referralNotification?.id, soundEnabled]);

  async function enableWebPush(): Promise<void> {
    setPushBusy(true);
    setPushError(null);

    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Web push is not supported by this browser.');
      }

      const publicKey = await getWebPushPublicKey();

      if (!publicKey) {
        throw new Error('Web push is not configured for this facility.');
      }

      const permission = await Notification.requestPermission();

      if (permission !== 'granted') {
        throw new Error('Allow notifications in your browser to enable web push.');
      }

      await navigator.serviceWorker.register('/service-worker.js');
      const registration = await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodePushKey(publicKey),
        });
      }

      const subscriptionJson = subscription.toJSON();

      if (
        !subscription.endpoint ||
        !subscriptionJson.keys?.p256dh ||
        !subscriptionJson.keys.auth
      ) {
        throw new Error('The browser returned an incomplete push subscription.');
      }

      await saveWebPushSubscription({
        endpoint: subscription.endpoint,
        p256dh: subscriptionJson.keys.p256dh,
        auth: subscriptionJson.keys.auth,
      });
      setPushEnabled(true);
    } catch (requestError) {
      setPushError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to enable web push notifications.',
      );
    } finally {
      setPushBusy(false);
    }
  }

  async function disableWebPush(): Promise<void> {
    setPushBusy(true);
    setPushError(null);

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        const subscriptionJson = subscription.toJSON();
        const p256dh = subscriptionJson.keys?.p256dh;
        const auth = subscriptionJson.keys?.auth;

        if (subscription.endpoint && p256dh && auth) {
          await deleteWebPushSubscription(subscription.endpoint, { p256dh, auth });
        }

        await subscription.unsubscribe();
      }

      setPushEnabled(false);
    } catch (requestError) {
      setPushError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to disable web push notifications.',
      );
    } finally {
      setPushBusy(false);
    }
  }

  async function dismissReferralNotification(): Promise<void> {
    if (!referralNotification) {
      return;
    }

    try {
      await markNotificationAsRead(referralNotification.id);
      await loadNotifications();
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to dismiss the referral notification.',
      );
    }
  }

  async function handleQueueCallAcknowledge(): Promise<void> {
    if (!queueCallNotification) {
      return;
    }

    const entryId = queueCallNotification.data?.queueEntryId;

    if (typeof entryId !== 'string') {
      setQueueCallError('This queue alert is missing its queue entry.');
      return;
    }

    setQueueCallBusy(true);
    setQueueCallError(null);

    try {
      await acknowledgeMyQueueCall(entryId);
      const updatedNotification = await markNotificationAsRead(
        queueCallNotification.id,
      );
      setNotifications((current) =>
        current.map((notification) =>
          notification.id === updatedNotification.id
            ? updatedNotification
            : notification,
        ),
      );
      await loadNotifications();
    } catch (requestError) {
      const staleCallMessages = [
        'Active queue call not found',
        'There is no active queue call awaiting acknowledgement',
        'Queue call was already acknowledged or is no longer active',
      ];

      if (
        requestError instanceof Error &&
        staleCallMessages.includes(requestError.message)
      ) {
        try {
          const updatedNotification = await markNotificationAsRead(
            queueCallNotification.id,
          );
          setNotifications((current) =>
            current.map((notification) =>
              notification.id === updatedNotification.id
                ? updatedNotification
                : notification,
            ),
          );
          await loadNotifications();
          setQueueCallError(null);
        } catch (dismissError) {
          setQueueCallError(
            dismissError instanceof Error
              ? dismissError.message
              : 'The queue call is no longer active, but its notification could not be dismissed.',
          );
        }
        return;
      }

      setQueueCallError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to acknowledge the queue call.',
      );
    } finally {
      setQueueCallBusy(false);
    }
  }

  async function handleDeleteNotification(notificationId: string): Promise<void> {
    setDeletingNotificationId(notificationId);
    setNotificationActionError(null);

    try {
      await deleteMyNotification(notificationId);
      setNotifications((current) =>
        current.filter((notification) => notification.id !== notificationId),
      );
    } catch (requestError) {
      setNotificationActionError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to delete this notification.',
      );
    } finally {
      setDeletingNotificationId(null);
    }
  }

  async function handleApprove(requestId: string): Promise<void> {
    setBusyRequestId(requestId);
    setError(null);

    try {
      await approvePatientRelationshipRequest(requestId);
      await loadDashboard(false, false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to approve this facility relationship.',
      );
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleDecline(requestId: string): Promise<void> {
    setBusyRequestId(requestId);
    setError(null);

    try {
      await declinePatientRelationshipRequest(requestId);
      await loadDashboard(false, false);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : 'Unable to decline this facility relationship.',
      );
    } finally {
      setBusyRequestId(null);
    }
  }

  if (loading || !dashboard) {
    return (
      <div
        className={`patient-app-shell ${sidebarCollapsed ? 'patient-sidebar-collapsed' : ''}`}
      >
        <PatientSidebar
          collapsed={sidebarCollapsed}
          currentPath={currentPath}
          patientName={dashboard?.patient.displayName ?? 'Patient'}
          onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
          onNavigate={onNavigate}
          onLogout={onLogout}
        />
        <div className="patient-app-main">
          <header className="patient-topbar">
            <div>
              <span className="patient-topbar-label">Your healthcare account</span>
              <strong>{loading ? 'Loading patient account' : 'Dashboard unavailable'}</strong>
            </div>
          </header>
          <main className="patient-app-content">
            {loading ? (
              <div className="patient-dashboard-loading" role="status" aria-live="polite">
                <p>Loading your Revaltrix patient dashboard...</p>
              </div>
            ) : (
              <section className="patient-dashboard-error">
                <p className="patient-dashboard-eyebrow">REVALTRIX</p>
                <h1>Patient dashboard unavailable</h1>
                <p>{error ?? 'Unable to load your patient account.'}</p>
                <button
                  type="button"
                  className="patient-dashboard-button"
                  onClick={() => void loadDashboard()}
                >
                  Try again
                </button>
              </section>
            )}
          </main>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`patient-app-shell ${sidebarCollapsed ? 'patient-sidebar-collapsed' : ''}`}
    >
      {queueCallNotification ? (
        <QueueCallAlert
          notification={queueCallNotification}
          busy={queueCallBusy}
          error={queueCallError}
          onAcknowledge={() => void handleQueueCallAcknowledge()}
        />
      ) : null}
      {referralNotification ? (
        <section
          role="alert"
          aria-live="assertive"
          className="patient-queue-call-alert"
        >
          <div>
            <p className="patient-dashboard-eyebrow">REFERRAL UPDATE</p>
            <h2>{referralNotification.title}</h2>
            <p>{referralNotification.body}</p>
          </div>
          <button
            type="button"
            className="patient-dashboard-button"
            onClick={() => void dismissReferralNotification()}
          >
            Dismiss
          </button>
        </section>
      ) : null}

      <PatientSidebar
        collapsed={sidebarCollapsed}
        currentPath={currentPath}
        patientName={dashboard.patient.displayName}
        onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onNavigate={onNavigate}
        onLogout={onLogout}
      />

      <div className="patient-app-main">
      <div className="patient-dashboard-notification-controls">
        <PatientNotificationBell
          unreadCount={unreadCount}
          expanded={showNotificationInbox}
          onClick={() => {
            setShowNotificationInbox((isOpen) => !isOpen);
            void loadNotifications();
          }}
        />
        {showNotificationInbox ? (
          <NotificationInboxPanel
            notifications={notifications}
            deletingNotificationId={deletingNotificationId}
            error={notificationActionError}
            onDelete={(notificationId) => void handleDeleteNotification(notificationId)}
          />
        ) : null}

        <button
          type="button"
          className="patient-dashboard-button secondary"
          onClick={() => void enableSound()}
        >
          {soundEnabled ? '🔊 Sound enabled' : '🔇 Enable sound'}
        </button>
        <button
          type="button"
          className="patient-dashboard-button secondary"
          disabled={pushBusy}
          onClick={() => void (pushEnabled ? disableWebPush() : enableWebPush())}
        >
          {pushBusy
            ? 'Updating web push...'
            : pushEnabled
              ? 'Disable web push'
              : 'Enable web push'}
        </button>
        {pushError ? (
          <span role="alert" className="patient-dashboard-inline-error">
            {pushError}
          </span>
        ) : null}
      </div>

        <header className="patient-topbar">
          <div>
            <span className="patient-topbar-label">
              Your healthcare account
            </span>
            <strong>
              {isOverviewContent
                ? `Welcome, ${dashboard.patient.firstName}`
                : currentPath === '/patient/encounters'
                  ? 'Care history'
                  : currentPath === '/patient/journey'
                    ? 'Care journey'
                    : currentPath === '/patient/facilities'
                      ? 'Facilities'
                      : currentPath === '/patient/requests'
                        ? 'Facility requests'
                  : currentPath === '/patient/appointments'
                    ? 'Appointments'
                    : currentPath === '/patient/laboratory'
                      ? 'Laboratory'
                      : currentPath === '/patient/prescriptions'
                        ? 'Prescriptions'
                        : currentPath === '/patient/shop'
                          ? 'Medical shop'
                        : currentPath === '/patient/documents'
                          ? 'Documents'
                          : currentPath === '/patient/access'
                            ? 'Data access'
                            : 'Your healthcare account'}
            </strong>
          </div>

          <div className="patient-topbar-actions">
            {(isOverviewContent || currentPath === '/patient/encounters') ? (
              <button
                type="button"
                className="patient-dashboard-button secondary"
                disabled={refreshing}
                onClick={() => void refreshOpenContent()}
              >
                {refreshing ? 'Refreshing...' : 'Refresh section'}
              </button>
            ) : null}
            <div className="patient-topbar-id">
              <span>Revaltrix Patient ID</span>
              <strong>{dashboard.patient.platformPatientId}</strong>
            </div>
          </div>
        </header>

        <main className="patient-app-content">
          {error ? (
            <div className="patient-dashboard-inline-error" role="alert">
              {error}
            </div>
          ) : null}

          {isOverviewContent ? (
          <div className="patient-dashboard-overview">
          <section className="patient-dashboard-hero">
            <div>
              <p className="patient-dashboard-eyebrow">PATIENT OVERVIEW</p>
              <h1>Welcome back, {dashboard.patient.firstName}</h1>
              <p>
                A current summary of your care, records, and healthcare connections.
              </p>
            </div>

            <div className="patient-dashboard-id-card">
              <span>Patient ID</span>
              <strong>{dashboard.patient.platformPatientId}</strong>
            </div>
          </section>

          {currentJourney ? (
            <section className="patient-dashboard-section">
              <div className="patient-dashboard-section-header">
                <div>
                  <p className="patient-dashboard-eyebrow">LIVE CARE</p>
                  <h2>Where you are now</h2>
                </div>

                <span className="patient-dashboard-live-badge">
                  ● Live
                </span>
              </div>

              {(() => {
                const current = currentJourney.current;
                const queueEntry = current?.queueEntry;

                if (!current) {
                  return null;
                }

                const queueStatus = queueEntry?.status ?? current.status;

                const statusLabel =
                  queueStatus === 'CALLED'
                    ? 'You have been called'
                    : queueStatus === 'IN_SERVICE'
                      ? 'You are being served'
                      : queueStatus === 'WAITING'
                        ? 'Waiting in queue'
                        : queueStatus.replaceAll('_', ' ');

                return (
                  <>
                    <article className="patient-current-care-card">
                      <div className="patient-current-care-main">
                        <p className="patient-dashboard-eyebrow">
                          CURRENT DEPARTMENT
                        </p>

                        <h2>
                          {current.department?.name ??
                            current.queue?.name ??
                            current.name}
                        </h2>

                        {current.branch?.name ? (
                          <p className="patient-current-care-location">
                            {current.branch.name}
                            {current.location ? ` · ${current.location}` : ''}
                          </p>
                        ) : current.location ? (
                          <p className="patient-current-care-location">
                            {current.location}
                          </p>
                        ) : null}

                        <div className="patient-current-care-status">
                          <strong>{statusLabel}</strong>

                          {queueEntry?.position !== null &&
                          queueEntry?.position !== undefined &&
                          ['WAITING', 'CREATED'].includes(queueStatus) ? (
                            <span>
                              Position #{queueEntry.position}
                            </span>
                          ) : null}

                          {current.estimatedWaitMinutes !== null &&
                          current.estimatedWaitMinutes !== undefined ? (
                            <span>
                              {current.estimatedWaitMinutes === 0
                                ? 'Being served now'
                                : `~${current.estimatedWaitMinutes} min wait`}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="patient-current-care-actions">
                        {queueEntry ? (
                          <button
                            type="button"
                            className="patient-dashboard-button"
                            onClick={() => setShowQueueDetails(true)}
                          >
                            View queue
                          </button>
                        ) : null}

                        <button
                          type="button"
                          className="patient-dashboard-button secondary"
                          onClick={() => setShowJourneyDetails(true)}
                        >
                          What happens next?
                        </button>
                      </div>
                    </article>

                    {currentJourney.next ? (
                      <div className="patient-next-step-card">
                        <div>
                          <p className="patient-dashboard-eyebrow">
                            NEXT
                          </p>
                          <strong>
                            {currentJourney.next.department?.name ??
                              currentJourney.next.name}
                          </strong>

                          {currentJourney.next.instruction ? (
                            <p>{currentJourney.next.instruction}</p>
                          ) : null}
                        </div>
                      </div>
                    ) : null}

                    {activeJourneys.length > 1 ? (
                      <details className="patient-other-care">
                        <summary>
                          Other active care
                          <span>{activeJourneys.length - 1}</span>
                        </summary>

                        <div className="patient-other-care-list">
                          {activeJourneys
                            .filter(
                              (item) =>
                                item.journey.id !== currentJourney.journey.id,
                            )
                            .map((item) => (
                              <div
                                className="patient-other-care-item"
                                key={item.journey.id}
                              >
                                <strong>
                                  {item.current?.department?.name ??
                                    item.current?.queue?.name ??
                                    item.current?.name}
                                </strong>

                                <span>
                                  {item.current?.queueEntry?.status?.replaceAll(
                                    '_',
                                    ' ',
                                  ) ?? item.current?.status}
                                </span>
                              </div>
                            ))}
                        </div>
                      </details>
                    ) : null}
                  </>
                );
              })()}
            </section>
          ) : null}

          {showQueueDetails && currentJourney?.current?.queueEntry ? (
            <div
              className="patient-dashboard-modal-backdrop"
              role="presentation"
              onClick={() => setShowQueueDetails(false)}
            >
              <section
                className="patient-dashboard-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="queue-details-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="patient-dashboard-modal-header">
                  <div>
                    <p className="patient-dashboard-eyebrow">
                      LIVE QUEUE
                    </p>
                    <h2 id="queue-details-title">
                      {currentJourney.current.department?.name ??
                        currentJourney.current.queue?.name}
                    </h2>
                  </div>

                  <button
                    type="button"
                    className="patient-dashboard-modal-close"
                    onClick={() => setShowQueueDetails(false)}
                    aria-label="Close queue details"
                  >
                    ×
                  </button>
                </div>

                <div className="patient-dashboard-modal-grid">
                  <div>
                    <span>Queue number</span>
                    <strong>
                      {currentJourney.current.queueEntry.queueNumber}
                    </strong>
                  </div>

                  <div>
                    <span>Status</span>
                    <strong>
                      {currentJourney.current.queueEntry.status.replaceAll(
                        '_',
                        ' ',
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Position</span>
                    <strong>
                      {currentJourney.current.queueEntry.position ??
                        'Calculating'}
                    </strong>
                  </div>

                  <div>
                    <span>Estimated wait</span>
                    <strong>
                      {currentJourney.current.estimatedWaitMinutes !== null &&
                      currentJourney.current.estimatedWaitMinutes !== undefined
                        ? currentJourney.current.estimatedWaitMinutes === 0
                          ? 'Now'
                          : `~${currentJourney.current.estimatedWaitMinutes} min`
                        : 'Calculating'}
                    </strong>
                  </div>
                </div>

                {currentJourney.current.instruction ? (
                  <div className="patient-dashboard-modal-instruction">
                    <strong>What to do</strong>
                    <p>{currentJourney.current.instruction}</p>
                  </div>
                ) : null}

                <button
                  type="button"
                  className="patient-dashboard-button"
                  onClick={() => setShowQueueDetails(false)}
                >
                  Done
                </button>
              </section>
            </div>
          ) : null}

          {showJourneyDetails && currentJourney ? (
            <div
              className="patient-dashboard-modal-backdrop"
              role="presentation"
              onClick={() => setShowJourneyDetails(false)}
            >
              <section
                className="patient-dashboard-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="journey-details-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="patient-dashboard-modal-header">
                  <div>
                    <p className="patient-dashboard-eyebrow">
                      YOUR CARE PATH
                    </p>
                    <h2 id="journey-details-title">
                      What happens next?
                    </h2>
                  </div>

                  <button
                    type="button"
                    className="patient-dashboard-modal-close"
                    onClick={() => setShowJourneyDetails(false)}
                    aria-label="Close care journey"
                  >
                    ×
                  </button>
                </div>

                <div className="patient-journey-timeline">
                  {currentJourney.steps.map((step) => (
                    <div
                      className={`patient-journey-timeline-item ${
                        step.id === currentJourney.current?.id
                          ? 'current'
                          : ''
                      }`}
                      key={step.id}
                    >
                      <div className="patient-journey-timeline-marker">
                        {step.status === 'COMPLETED' ? '✓' : '•'}
                      </div>

                      <div>
                        <strong>
                          {step.department?.name ?? step.name}
                        </strong>

                        <span>
                          {step.status.replaceAll('_', ' ')}
                        </span>

                        {step.location ? (
                          <p>Go to: {step.location}</p>
                        ) : null}

                        {step.instruction ? (
                          <p>{step.instruction}</p>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  className="patient-dashboard-button"
                  onClick={() => setShowJourneyDetails(false)}
                >
                  Close
                </button>
              </section>
            </div>
          ) : null}

          {careHistory?.data.length ? (
            <details className="patient-care-history-dropdown">
              <summary>
                <span>
                  <strong>Care history</strong>
                  <small>Your completed care and clinical information</small>
                </span>
                <span>{careHistory.data.length}</span>
              </summary>

              <div className="patient-care-history-list">
                {careHistory.data.map((visit, visitIndex) => (
                  <details
                    key={`${visit.facility.code}-${visit.date}-${visitIndex}`}
                    className="patient-care-history-record"
                  >
                    <summary className="patient-care-history-summary">
                      <div className="patient-care-history-summary-main">
                        <div className="patient-care-history-summary-title">
                          <strong>{visit.facility.name}</strong>
                          <small>
                            {new Date(visit.date).toLocaleString()}
                          </small>
                        </div>

                        <span
                          className={`patient-care-history-status ${
                            visit.status === 'COMPLETED'
                              ? 'patient-care-history-status-completed'
                              : visit.status === 'ACTIVE'
                                ? 'patient-care-history-status-active'
                                : 'patient-care-history-status-other'
                          }`}
                        >
                          {visit.status === 'COMPLETED'
                            ? 'Completed'
                            : visit.status === 'ACTIVE'
                              ? 'In progress'
                              : visit.status.replaceAll('_', ' ')}
                        </span>
                      </div>

                      <div className="patient-care-history-summary-stats">
                        <span>
                          <strong>{visit.departments.length}</strong>
                          <small>Departments</small>
                        </span>

                        <span>
                          <strong>{visit.clinicalNotes.length}</strong>
                          <small>Clinical notes</small>
                        </span>

                        <span>
                          <strong>
                            {visit.departments.reduce(
                              (total, department) =>
                                total + department.care.length,
                              0,
                            )}
                          </strong>
                          <small>Care records</small>
                        </span>

                        <span>
                          <strong>{visit.referrals.length}</strong>
                          <small>Referrals</small>
                        </span>
                      </div>
                    </summary>

                    <div className="patient-care-history-details">
                      <div className="patient-history-overview">
                        <div>
                          <span>Facility</span>
                          <strong>{visit.facility.name}</strong>
                        </div>

                        <div>
                          <span>Date</span>
                          <strong>
                            {new Date(visit.date).toLocaleString()}
                          </strong>
                        </div>
                      </div>

                      {visit.clinicalNotes.length > 0 ? (
                        <section className="patient-history-clinical-section">
                          <h4>Clinical information</h4>

                          {visit.clinicalNotes.map((note, noteIndex) => (
                            <article
                              key={`${note.type}-${note.createdAt}-${noteIndex}`}
                              className="patient-history-clinical-note"
                            >
                              {note.chiefComplaint ? (
                                <div>
                                  <span>Reason for visit</span>
                                  <p>{note.chiefComplaint}</p>
                                </div>
                              ) : null}

                              {note.subjective ? (
                                <div>
                                  <span>What you reported</span>
                                  <p>{note.subjective}</p>
                                </div>
                              ) : null}

                              {note.objective ? (
                                <div>
                                  <span>Clinical findings</span>
                                  <p>{note.objective}</p>
                                </div>
                              ) : null}

                              {note.assessment ? (
                                <div>
                                  <span>Assessment</span>
                                  <p>{note.assessment}</p>
                                </div>
                              ) : null}

                              {note.plan ? (
                                <div>
                                  <span>Plan and advice</span>
                                  <p>{note.plan}</p>
                                </div>
                              ) : null}
                            </article>
                          ))}
                        </section>
                      ) : null}

                      {visit.departments.length > 0 ? (
                        <section className="patient-history-departments">
                          <h4>Care received</h4>

                          {visit.departments.map((department, departmentIndex) => (
                            <details
                              key={`${department.sequence}-${department.name}-${departmentIndex}`}
                              className="patient-history-step"
                            >
                              <summary className="patient-history-step-header">
                                <div>
                                  <strong>
                                    {department.department?.name ??
                                      department.name}
                                  </strong>
                                  <span>
                                    {department.branch?.name
                                      ? `${department.branch.name}${
                                          department.location
                                            ? ` · ${department.location}`
                                            : ''
                                        }`
                                      : department.location ?? ''}
                                  </span>
                                </div>

                                <b>
                                  {department.status === 'COMPLETED'
                                    ? 'Completed'
                                    : department.status.replaceAll('_', ' ')}
                                </b>
                              </summary>

                              <div className="patient-history-step-content">
                                {department.description ? (
                                  <div>
                                    <span>Service</span>
                                    <p>{department.description}</p>
                                  </div>
                                ) : null}

                                {department.instruction ? (
                                  <div>
                                    <span>Instructions</span>
                                    <p>{department.instruction}</p>
                                  </div>
                                ) : null}

                                {department.care.length > 0 ? (
                                  <div className="patient-history-care-records">
                                    <h5>What was done</h5>

                                    {department.care.map((record, recordIndex) => (
                                      <article
                                        key={`${record.recordedAt}-${recordIndex}`}
                                        className="patient-history-care-record"
                                      >
                                        {record.note ? (
                                          <div>
                                            <span>Care notes</span>
                                            <p>{record.note}</p>
                                          </div>
                                        ) : null}

                                        {record.procedures ? (
                                          <div>
                                            <span>Services / procedures</span>
                                            <p>{record.procedures}</p>
                                          </div>
                                        ) : null}

                                        {record.attachments.length > 0 ? (
                                          <div>
                                            <span>Documents</span>
                                            <div className="patient-history-attachments">
                                              {record.attachments.map((attachment) => (
                                                <span
                                                  key={attachment.id}
                                                  className="patient-history-attachment"
                                                >
                                                  {attachment.fileName}
                                                </span>
                                              ))}
                                            </div>
                                          </div>
                                        ) : null}
                                      </article>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="patient-history-empty">
                                    No additional care notes were recorded for
                                    this department.
                                  </p>
                                )}

                                {department.referrals.length > 0 ? (
                                  <div className="patient-history-referrals">
                                    <h5>Referral / next care</h5>

                                    {department.referrals.map(
                                      (referral, referralIndex) => (
                                        <article
                                          key={`${referral.createdAt}-${referralIndex}`}
                                        >
                                          <strong>
                                            {referral.fromDepartment ??
                                              'This department'}
                                            {referral.toDepartment
                                              ? ` → ${referral.toDepartment}`
                                              : ''}
                                          </strong>

                                          {referral.reason ? (
                                            <p>
                                              <span>Reason:</span>{' '}
                                              {referral.reason}
                                            </p>
                                          ) : null}

                                          {referral.instruction ? (
                                            <p>
                                              <span>Instructions:</span>{' '}
                                              {referral.instruction}
                                            </p>
                                          ) : null}
                                        </article>
                                      ),
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            </details>
                          ))}
                        </section>
                      ) : null}

                      {visit.referrals.length > 0 ? (
                        <section className="patient-history-referrals">
                          <h4>Care referrals</h4>

                          {visit.referrals.map((referral, referralIndex) => (
                            <article
                              key={`${referral.createdAt}-${referralIndex}`}
                            >
                              <strong>
                                {referral.fromDepartment ??
                                  'Care department'}
                                {referral.toDepartment
                                  ? ` → ${referral.toDepartment}`
                                  : ''}
                              </strong>

                              {referral.reason ? (
                                <p>
                                  <span>Reason:</span> {referral.reason}
                                </p>
                              ) : null}

                              {referral.instruction ? (
                                <p>
                                  <span>Instructions:</span>{' '}
                                  {referral.instruction}
                                </p>
                              ) : null}
                            </article>
                          ))}
                        </section>
                      ) : null}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ) : null}


      <section className="patient-overview-cards" aria-label="Patient summaries">
        <PatientOverviewCard
          title="My profile"
          metric={`${dashboard.identities.filter((identity) => identity.verified).length} verified`}
          summary={`${dashboard.patient.displayName}${dashboard.patient.location ? ` · ${dashboard.patient.location}` : ''}`}
          path="/patient/profile"
          tone="mint"
          icon={UserRound}
          onNavigate={onNavigate}
        />
        <PatientOverviewCard
          title="Care journey"
          metric={journey ? String(activeJourneys.length) : '—'}
          summary={
            currentJourney?.current
              ? `${currentJourney.current.department?.name ?? currentJourney.current.name} · ${currentJourney.current.queueEntry?.status?.replaceAll('_', ' ') ?? currentJourney.current.status.replaceAll('_', ' ')}`
              : journey
                ? 'No active care journey'
                : 'Journey summary unavailable'
          }
          path="/patient/journey"
          tone="blue"
          icon={Activity}
          onNavigate={onNavigate}
        />
        <PatientOverviewCard
          title="Care history"
          metric={careHistory ? String(careHistory.data.length) : '—'}
          summary={
            careHistory
              ? `${careHistory.data.reduce((total, visit) => total + visit.clinicalNotes.length, 0)} clinical notes across recorded visits`
              : 'Care history summary unavailable'
          }
          path="/patient/encounters"
          tone="rose"
          icon={ClipboardList}
          onNavigate={onNavigate}
        />
        <PatientOverviewCard
          title="Family"
          metric={familySummary ? String(familySummary.activeRelationships) : '—'}
          summary={
            familySummary
              ? `${familySummary.pendingRequests} pending family requests`
              : 'Family summary unavailable'
          }
          path="/patient/family"
          tone="violet"
          icon={UsersRound}
          onNavigate={onNavigate}
        />
        <PatientOverviewCard
          title="Facilities"
          metric={String(dashboard.facilities.length)}
          summary={`${dashboard.facilities.filter((facility) => facility.relationshipStatus === 'ACTIVE').length} active relationships`}
          path="/patient/facilities"
          tone="amber"
          icon={Building2}
          onNavigate={onNavigate}
        />
        <PatientOverviewCard
          title="Requests"
          metric={String(dashboard.pendingRelationshipRequests.length)}
          summary={
            dashboard.pendingRelationshipRequests.length
              ? 'Facility requests need your review'
              : 'No facility requests need your review'
          }
          path="/patient/requests"
          tone="teal"
          icon={ShieldCheck}
          onNavigate={onNavigate}
        />
        <PatientOverviewCard
          title="Appointments"
          metric="Not connected"
          summary="Appointment records are not connected yet"
          path="/patient/appointments"
          tone="coral"
          icon={CalendarDays}
          onNavigate={onNavigate}
        />
        <PatientOverviewCard
          title="Laboratory"
          metric="Not connected"
          summary="Laboratory results are not connected yet"
          path="/patient/laboratory"
          tone="cyan"
          icon={FlaskConical}
          onNavigate={onNavigate}
        />
        <PatientOverviewCard
          title="Prescriptions"
          metric="Not connected"
          summary="Prescription records are not connected yet"
          path="/patient/prescriptions"
          tone="yellow"
          icon={Pill}
          onNavigate={onNavigate}
        />
        <PatientOverviewCard
          title="Documents"
          metric="Not connected"
          summary="Patient documents are not connected yet"
          path="/patient/documents"
          tone="slate"
          icon={FileText}
          onNavigate={onNavigate}
        />
        <PatientOverviewCard
          title="Data access"
          metric="Not connected"
          summary="Access activity is not connected yet"
          path="/patient/access"
          tone="green"
          icon={KeyRound}
          onNavigate={onNavigate}
        />
      </section>

          {dashboard.pendingRelationshipRequests.length > 0 ? (
            <section className="patient-dashboard-section">
              <div className="patient-dashboard-section-header">
                <div>
                  <p className="patient-dashboard-eyebrow">
                    Action required
                  </p>
                  <h2>Facility relationship requests</h2>
                </div>
                <span className="patient-dashboard-count">
                  {dashboard.pendingRelationshipRequests.length}
                </span>
              </div>

              <div className="patient-dashboard-request-list">
                {dashboard.pendingRelationshipRequests.map((request) => (
                  <RelationshipRequestCard
                    key={request.id}
                    request={request}
                    busyRequestId={busyRequestId}
                    onApprove={(id) => void handleApprove(id)}
                    onDecline={(id) => void handleDecline(id)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          <section className="patient-dashboard-section">
            <div className="patient-dashboard-section-header">
              <div>
                <p className="patient-dashboard-eyebrow">
                  Healthcare relationships
                </p>
                <h2>Your facilities</h2>
              </div>
            </div>

            {dashboard.facilities.length === 0 ? (
              <div className="patient-dashboard-empty">
                <h3>No healthcare facility relationships yet</h3>
                <p>
                  When a healthcare facility establishes a relationship
                  with your Revaltrix patient account, it will appear here.
                </p>
              </div>
            ) : (
              <div className="patient-dashboard-facility-list">
                {dashboard.facilities.map((facility) => (
                  <article
                    className="patient-dashboard-facility-card"
                    key={facility.patientRecordId}
                  >
                    <div>
                      <p className="patient-dashboard-eyebrow">
                        {getFacilityType(facility.facility.type)}
                      </p>
                      <h3>{facility.facility.name}</h3>
                      {facility.facility.legalName &&
                      facility.facility.legalName !== facility.facility.name ? (
                        <p>{facility.facility.legalName}</p>
                      ) : null}
                    </div>

                    <div className="patient-dashboard-facility-meta">
                      <span>
                        Patient number: {facility.patientNumber}
                      </span>
                      <span>
                        {getRelationshipLabel(
                          facility.relationshipStatus,
                        )}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
          </div>
          ) : currentPath === '/patient/encounters' ? (
            <section className="patient-dashboard-section patient-patient-content-panel">
              <div className="patient-dashboard-section-header">
                <div>
                  <p className="patient-dashboard-eyebrow">YOUR RECORDS</p>
                  <h1>Care history</h1>
                </div>
              </div>
              <label className="patient-record-search">
                <Search size={18} aria-hidden="true" />
                <input
                  type="search"
                  value={careHistorySearch}
                  onChange={(event) => setCareHistorySearch(event.target.value)}
                  placeholder="Search facilities, dates, departments or care notes"
                  aria-label="Search care history"
                />
              </label>
              {filteredCareHistoryFacilityGroups.length ? (
                <div className="patient-record-facility-list">
                  {filteredCareHistoryFacilityGroups.map((group) => (
                    <details
                      className="patient-record-facility"
                      key={group.facility.code}
                      open={group.visits.some((visit) => visit.journeyId === selectedJourneyId)}
                    >
                      <summary>
                        <span>
                          <strong>{group.facility.name}</strong>
                          <small>{group.facility.code} · {group.visits.length} visit{group.visits.length === 1 ? '' : 's'}</small>
                        </span>
                        <span className="patient-record-facility-action">Show visits</span>
                      </summary>
                      <div className="patient-record-visit-list">
                        {group.visits.map((visit) => (
                          <details
                            className="patient-record-visit"
                            key={visit.journeyId}
                            open={visit.journeyId === selectedJourneyId}
                          >
                            <summary>
                              <span>
                                <strong>{new Date(visit.date).toLocaleDateString()}</strong>
                                <small>{new Date(visit.date).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {visit.departments.length} department{visit.departments.length === 1 ? '' : 's'}</small>
                              </span>
                              <b>{visit.status.replaceAll('_', ' ')}</b>
                            </summary>
                            <div className="patient-record-visit-details">
                              {visit.clinicalNotes.length ? (
                                <section className="patient-history-clinical-section">
                                  <h2>Clinical summary</h2>
                                  {visit.clinicalNotes.map((note, noteIndex) => (
                                    <article className="patient-history-clinical-note" key={`${note.type}-${note.createdAt}-${noteIndex}`}>
                                      <strong>{note.type.replaceAll('_', ' ')}</strong>
                                      {note.chiefComplaint ? <p><b>Reason:</b> {note.chiefComplaint}</p> : null}
                                      {note.assessment ? <p><b>Assessment:</b> {note.assessment}</p> : null}
                                      {note.plan ? <p><b>Plan:</b> {note.plan}</p> : null}
                                    </article>
                                  ))}
                                </section>
                              ) : null}
                              {visit.departments.length ? (
                                <section className="patient-history-departments">
                                  <h2>Department visits</h2>
                                  {visit.departments.map((department, departmentIndex) => (
                                    <article className="patient-history-step" key={`${department.sequence}-${department.name}-${departmentIndex}`}>
                                      <div className="patient-history-step-header">
                                        <div>
                                          <strong>{department.department?.name ?? department.name}</strong>
                                          <span>{department.branch?.name ?? department.location ?? 'Location not provided'}</span>
                                        </div>
                                        <b>{department.status.replaceAll('_', ' ')}</b>
                                      </div>
                                      {department.description ? <p>{department.description}</p> : null}
                                      {department.care.map((record, recordIndex) => (
                                        <div className="patient-history-care-record" key={`${record.recordedAt}-${recordIndex}`}>
                                          <span>{new Date(record.recordedAt).toLocaleString()}</span>
                                          {record.note ? <p>{record.note}</p> : null}
                                          {record.procedures ? <p><b>Services / procedures:</b> {record.procedures}</p> : null}
                                          {record.attachments.length ? (
                                            <div className="patient-record-attachment-list">
                                              {record.attachments.map((attachment) => (
                                                <button
                                                  type="button"
                                                  className="patient-record-view-file"
                                                  key={attachment.id}
                                                  onClick={() => void openCareAttachment(attachment)}
                                                  disabled={viewingAttachmentId === attachment.id}
                                                >
                                                  <Eye size={15} aria-hidden="true" />
                                                  {viewingAttachmentId === attachment.id ? 'Opening…' : `View ${attachment.fileName}`}
                                                </button>
                                              ))}
                                            </div>
                                          ) : null}
                                        </div>
                                      ))}
                                    </article>
                                  ))}
                                </section>
                              ) : null}
                              {visit.referrals.length ? (
                                <section className="patient-history-referrals">
                                  <h2>Referrals</h2>
                                  {visit.referrals.map((referral, referralIndex) => (
                                    <article key={`${referral.createdAt}-${referralIndex}`}>
                                      <strong>{referral.fromDepartment ?? 'Care team'}{referral.toDepartment ? ` to ${referral.toDepartment}` : ''}</strong>
                                      {referral.reason ? <p>{referral.reason}</p> : null}
                                      {referral.instruction ? <p>{referral.instruction}</p> : null}
                                    </article>
                                  ))}
                                </section>
                              ) : null}
                            </div>
                          </details>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <div className="patient-dashboard-empty">
                  <h2>{careHistory?.data.length ? 'No matching visits' : 'No care history yet'}</h2>
                  <p>{careHistory?.data.length ? 'Try another facility, date or department.' : 'Completed care visits will appear here.'}</p>
                </div>
              )}
            </section>
          ) : currentPath === '/patient/journey' ? (
            <section className="patient-dashboard-section patient-patient-content-panel">
              <div className="patient-dashboard-section-header">
                <div>
                  <p className="patient-dashboard-eyebrow">YOUR CARE PATH</p>
                  <h1>Care journey</h1>
                </div>
              </div>
              <label className="patient-record-search">
                <Search size={18} aria-hidden="true" />
                <input
                  type="search"
                  value={journeySearch}
                  onChange={(event) => setJourneySearch(event.target.value)}
                  placeholder="Search facilities, dates or departments"
                  aria-label="Search care journeys"
                />
              </label>
              {filteredJourneyFacilityGroups.length ? (
                <div className="patient-record-facility-list">
                  {filteredJourneyFacilityGroups.map((group) => (
                    <details
                      className="patient-record-facility"
                      key={group.facility.id}
                      open={group.journeys.some((item) => item.journey.id === selectedJourneyId)}
                    >
                      <summary>
                        <span>
                          <strong>{group.facility.name}</strong>
                          <small>{group.facility.code} · {group.journeys.length} visit{group.journeys.length === 1 ? '' : 's'}</small>
                        </span>
                        <span className="patient-record-facility-action">Show visits</span>
                      </summary>
                      <div className="patient-record-visit-list">
                        {group.journeys.map((item) => {
                          const lastStep = item.steps[item.steps.length - 1];
                          const summaryStep = item.current ?? lastStep;
                          const checkIn = item.steps.find((step) => step.type === 'CHECK_IN');
                          const visitDate = checkIn?.queueEntry?.checkedInAt ?? item.journey.startedAt;

                          return (
                            <article className="patient-journey-visit" key={item.journey.id}>
                              <div className="patient-journey-visit-main">
                                <div>
                                  <strong>{new Date(visitDate).toLocaleDateString()}</strong>
                                  <span>{new Date(visitDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} · {item.steps.length} care steps</span>
                                </div>
                                <b>{item.journey.status.replaceAll('_', ' ')}</b>
                              </div>
                              <p>
                                {summaryStep?.department?.name ?? summaryStep?.name ?? 'Visit'}
                                {summaryStep ? ` · ${summaryStep.status.replaceAll('_', ' ').toLowerCase()}` : ''}
                              </p>
                              <button
                                type="button"
                                className="patient-record-see-more"
                                onClick={() => onNavigate(`/patient/encounters?journeyId=${encodeURIComponent(item.journey.id)}`)}
                              >
                                See more <ArrowUpRight size={16} aria-hidden="true" />
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <div className="patient-dashboard-empty">
                  <h2>{journey?.data.length ? 'No matching visits' : 'No care journeys yet'}</h2>
                  <p>{journey?.data.length ? 'Try another facility, date or department.' : 'Active and completed care journeys will appear here.'}</p>
                </div>
              )}
            </section>
          ) : currentPath === '/patient/facilities' ? (
            <section className="patient-dashboard-section patient-patient-content-panel">
              <div className="patient-dashboard-section-header">
                <div><p className="patient-dashboard-eyebrow">CONNECTED CARE</p><h1>Your facilities</h1></div>
                <span className="patient-dashboard-count">{dashboard.facilities.length}</span>
              </div>
              {dashboard.facilities.length ? (
                <div className="patient-dashboard-facility-list">
                  {dashboard.facilities.map((facility) => (
                    <article className="patient-dashboard-facility-card" key={facility.patientRecordId}>
                      <div>
                        <p className="patient-dashboard-eyebrow">{getFacilityType(facility.facility.type)}</p>
                        <h2>{facility.facility.name}</h2>
                        {facility.facility.legalName && facility.facility.legalName !== facility.facility.name ? <p>{facility.facility.legalName}</p> : null}
                      </div>
                      <div className="patient-dashboard-facility-meta">
                        <span>Patient number: {facility.patientNumber}</span>
                        <span>{getRelationshipLabel(facility.relationshipStatus)}</span>
                        <span>Connected {new Date(facility.registeredAt).toLocaleDateString()}</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="patient-dashboard-empty"><h2>No facilities connected</h2><p>Connected healthcare facilities will appear here.</p></div>
              )}
            </section>
          ) : currentPath === '/patient/requests' ? (
            <section className="patient-dashboard-section patient-patient-content-panel">
              <div className="patient-dashboard-section-header">
                <div><p className="patient-dashboard-eyebrow">ACTION REQUIRED</p><h1>Facility requests</h1></div>
                <span className="patient-dashboard-count">{dashboard.pendingRelationshipRequests.length}</span>
              </div>
              {dashboard.pendingRelationshipRequests.length ? (
                <div className="patient-dashboard-request-list">
                  {dashboard.pendingRelationshipRequests.map((request) => (
                    <RelationshipRequestCard
                      key={request.id}
                      request={request}
                      busyRequestId={busyRequestId}
                      onApprove={(id) => void handleApprove(id)}
                      onDecline={(id) => void handleDecline(id)}
                    />
                  ))}
                </div>
              ) : (
                <div className="patient-dashboard-empty"><h2>No facility requests</h2><p>New requests from healthcare facilities will appear here.</p></div>
              )}
            </section>
          ) : currentPath === '/patient/appointments' ? (
            <PatientAppointmentsSection onNavigate={onNavigate} />
          ) : currentPath === '/patient/shop' ? (
            <PatientShopPage />
          ) : (
            <section className="patient-dashboard-section patient-patient-content-panel">
              <p className="patient-dashboard-eyebrow">PATIENT ACCOUNT</p>
              <h1>{unavailablePatientSections[currentPath]?.title ?? 'Patient section'}</h1>
              <div className="patient-dashboard-empty">
                <h2>Patient service not connected</h2>
                <p>{unavailablePatientSections[currentPath]?.detail ?? 'This patient section is not available yet.'}</p>
              </div>
            </section>
          )}
        </main>

        {attachmentPreview ? (
          <div
            className="patient-file-preview-backdrop"
            role="presentation"
            onClick={() => setAttachmentPreview(null)}
          >
            <section
              className="patient-file-preview"
              role="dialog"
              aria-modal="true"
              aria-labelledby="patient-file-preview-title"
              onClick={(event) => event.stopPropagation()}
            >
              <header>
                <div>
                  <p className="patient-dashboard-eyebrow">CARE DOCUMENT</p>
                  <h2 id="patient-file-preview-title">{attachmentPreview.fileName}</h2>
                </div>
                <button
                  type="button"
                  className="patient-file-preview-close"
                  onClick={() => setAttachmentPreview(null)}
                  aria-label="Close file preview"
                >
                  <X size={20} aria-hidden="true" />
                </button>
              </header>
              <div className="patient-file-preview-content">
                {attachmentPreview.contentType.startsWith('image/') ? (
                  <img src={attachmentPreview.url} alt={attachmentPreview.fileName} />
                ) : (
                  <iframe
                    src={attachmentPreview.url}
                    title={attachmentPreview.fileName}
                  />
                )}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
