# Online Appointment Booking

## Current flow

Patients can browse live facilities and public services without signing in. Appointment discovery uses branches and services selected in the tenant's published website, and only lists facilities that have enabled online booking. Changes to the website draft do not change discovery until that revision is published. Patients choose a department rather than a provider; availability is matched to that department and the selected slot is assigned to an available provider internally. Branch coordinates are optional and are never inferred from tenant-level coordinates. When configured, the patient dashboard displays a Google map and sorts facilities by straight-line branch distance; otherwise it keeps the manual search and facility list available.

Booking requires the facility to remain live and published with online booking enabled, the selected branch and service to remain publicly selected, an active patient account, a verified identity, and an active patient registration at the selected facility. The server creates a five-minute, idempotent slot hold for an available provider in the selected department, then requests the fixed KSh 100 deposit. An appointment is created only after a Daraja callback is matched to the payment intent and an authoritative STK query confirms the result, amount, phone, and receipt. The appointment remains a normal `PATIENT_PORTAL` appointment and is managed in the tenant Appointments page.

Appointments are queued only through the existing check-in/encounter workflow. Booking or payment does not create an encounter or queue entry.

## Required configuration

### Google Maps

Set `VITE_GOOGLE_MAPS_API_KEY` in the web build environment. Restrict this key by allowed web referrers and the Google Maps JavaScript API. This key is used in the browser and must not be a server credential. Branch markers and distance ranking require latitude and longitude to be entered on each branch. Missing branch coordinates remain missing; the application does not copy tenant coordinates to every branch.

Google Maps address autocomplete is not currently implemented. Branch addresses and coordinates can be entered manually. The map falls back to location results if the browser key is missing or the Maps script fails to load.

### Daraja STK Push

The API reads these server-only environment values:

- `DARAJA_ENABLED=true`
- `DARAJA_SETTLEMENT_APPROVED=true` only after the merchant/settlement arrangement has written approval
- `DARAJA_ENVIRONMENT=sandbox` or `production`
- `DARAJA_CONSUMER_KEY`
- `DARAJA_CONSUMER_SECRET`
- `DARAJA_SHORTCODE`
- `DARAJA_PASSKEY`
- `DARAJA_CALLBACK_TOKEN` (at least 32 characters, generated securely)
- `DARAJA_CALLBACK_URL` (public HTTPS callback URL whose final path segment is exactly the callback token)

The integration is disabled unless every required value and settlement approval are present. Do not set settlement approval merely to make the button work. Confirm the authorized PayBill/Till, settlement owner, reconciliation owner, and refund responsibilities with Safaricom and the relevant legal/compliance reviewers first. Never put Daraja credentials in Vite variables or source control.

The current implementation does not initiate M-Pesa reversals. Facilities track cash/electronic refunds in the appointment refund ledger; electronic refunds require evidence and a provider transaction reference. Automated M-Pesa refund support requires a separately approved Daraja reversal integration.

## Database deployment

New changes are additive migrations:

- `20261021100000_add_branch_coordinates`
- `20261021110000_appointment_deposit_workflow`
- `20261021120000_notification_idempotency`

This workspace's configured database had seven older unapplied migrations when inspected, before these three new migrations were added. Do not run `db push` or apply only the new migrations to production. Review the current target environment with `prisma migrate status`, reconcile and review the existing backlog, then deploy the ordered migrations through the normal database release process after backup and approval. No migration was applied during implementation.

## Remaining production work

- Configure and test the Google browser key and Daraja sandbox credentials/callback using Safaricom's approved test environment.
- Complete Daraja production approval, shortcode registration, callback reachability, settlement ownership, and finance reconciliation procedures.
- Add Google Places address autocomplete if desired; the current coordinate fields are manual.
- Add an operations reconciliation queue for paid callbacks that cannot finalize because a hold expired or a slot was taken. Such cases remain `RECONCILIATION_REQUIRED`; they are not converted to appointments automatically or marked unpaid.
- Add short-lived patient QR/self-check-in tokens and a formal append-only attendance/dispute evidence workflow. Existing staff check-in still creates/reconciles the encounter and queue; a QR or patient self-check-in workflow is not included yet.
- Define and implement configured cancellation/no-show deadlines, refund-overdue escalation, and approved dispute review roles before enabling production deposits.

## Verification

Safe local checks run during implementation: Prisma schema validation and client generation, API TypeScript check, web production build, and focused unit tests for Kenyan phone normalization and branch-distance calculations. No real STK request, production payment, database migration, or provider callback was executed.