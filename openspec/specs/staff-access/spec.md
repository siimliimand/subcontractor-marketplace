# Staff Access Specification

## Purpose
Define how the concierge cockpit authenticates staff via Cloudflare Access, provisions staff identities, denies non-staff identities, and attributes every cockpit mutation to an authenticated staff user.

## Requirements

### Requirement: Cockpit requires valid Cloudflare Access authentication
Every cockpit route SHALL reject any request that does not carry a valid Cloudflare Access JWT (signature verified against the team's Access domain, matching audience). Rejected requests MUST receive no application data.

#### Scenario: Missing or invalid token
- **WHEN** a request arrives without a `Cf-Access-Jwt-Assertion` header, or with a JWT that fails signature or audience validation
- **THEN** the system returns 403 with no cockpit content and writes no application data

#### Scenario: Valid staff token
- **WHEN** a request carries a valid Access JWT for a team member
- **THEN** the cockpit serves the requested page and attributes all actions to that team member

### Requirement: Staff identity auto-provisioning
On first successful authentication, the system SHALL create a `users` record from the JWT email with role `staff`, and reuse that record on every subsequent login.

#### Scenario: First login
- **WHEN** a team member authenticates via Access for the first time
- **THEN** a user record is created with their email and the `staff` role, and the login is recorded as an audit event

#### Scenario: Repeat login
- **WHEN** the same team member authenticates again
- **THEN** the existing user record is reused, not duplicated

### Requirement: Non-staff identities are denied
An authenticated Access identity whose email is not in the staff allowlist SHALL be denied all cockpit pages and actions.

#### Scenario: Outsider with valid token
- **WHEN** a valid Access JWT belongs to an identity not marked as staff
- **THEN** the system returns 403 and records the denied attempt

### Requirement: Actor attribution
Every cockpit mutation SHALL be attributed to the authenticated staff user, recorded on the audit event.

#### Scenario: Action attribution
- **WHEN** a staff user performs any create or update action
- **THEN** the resulting audit event stores that user's id and email

### Requirement: Public token routes are exempt from Access and leak nothing
The routes `/e/*` (token landing and submit) and `/t/*` (tracking pixel) SHALL be
served without Cloudflare Access authentication, and MUST NOT expose any data beyond
the request brief already contained in the sent email; all other routes, including
every cockpit API, remain behind valid Access JWT authentication as before.

#### Scenario: Unauthenticated token landing
- **WHEN** an anonymous visitor opens a valid token landing URL
- **THEN** the page renders without Access login and shows only the brief fields the
  email already disclosed

#### Scenario: Existing guard unchanged
- **WHEN** an anonymous visitor calls any `/api/*` route or cockpit page other than the
  token and pixel routes
- **THEN** the request is denied exactly as before this change

#### Scenario: Neutral not-found behaviour
- **WHEN** any invalid, used, or expired token URL is requested
- **THEN** the response is a neutral error page and does not reveal which of the three
  cases applies
