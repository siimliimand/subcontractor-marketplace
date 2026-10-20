# Spec Delta

## Purpose

Multi-user provider company accounts: named people per company with roles,
invited through the existing single-use email-token pattern — no passwords — so a
company is no longer tied to one contact inbox.

## ADDED Requirements

### Requirement: Provider users with roles
A provider company SHALL have named users with a role of owner or coordinator.
Staff SHALL provision the first owner; owners SHALL manage their company's users
(invite, disable). Every user lifecycle change is audit-logged. Company-level
identity (contact email) is unaffected.

#### Scenario: First owner provisioned
- **WHEN** staff provisions the first owner for a company
- **THEN** a user record is created in invited state, an invite is issued, and the provisioning is audit-logged

#### Scenario: Owner invites a coordinator
- **WHEN** an owner invites a new coordinator by email
- **THEN** the user is created in invited state with the coordinator role, an audit event records the invitation, and the invite respects the suppression list

### Requirement: Email-token login without passwords
Provider users SHALL authenticate through single-use expiring email tokens — the
same pattern as existing provider token flows — with no passwords stored.
Disabled users' tokens SHALL be rejected, and login updates last-login time.

#### Scenario: Login via token
- **WHEN** a provider user opens their single-use invite or login link in time
- **THEN** they are authenticated as that user for the session scope and the token cannot be reused

#### Scenario: Disabled user rejected
- **WHEN** a disabled user's token is presented
- **THEN** authentication is rejected with a generic error that does not distinguish disabled from invalid tokens

### Requirement: Company-scoped access
A provider user SHALL see and act only on their own company's data — responses,
availability, calendar, bookings. Coordinators SHALL manage availability, calendar,
and responses; owners SHALL additionally manage users. Staff SHALL retain full
oversight of all companies.

#### Scenario: Coordinator blocked cross-company
- **WHEN** a coordinator requests another company's data
- **THEN** the request is denied and the denial is not distinguishable from a missing record

#### Scenario: Owner manages users, coordinator does not
- **WHEN** a coordinator attempts to invite or disable a user of their own company
- **THEN** the action is rejected as owner-only
