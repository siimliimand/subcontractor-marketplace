## ADDED Requirements

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
