## ADDED Requirements

### Requirement: Single-use expiring response tokens
The system SHALL issue HMAC-signed single-use tokens per outreach entry for the
purposes accept, quote, decline, bound to that entry's company and request, expiring
after a configurable period (default 7 days).

#### Scenario: Token used once
- **WHEN** a valid token is redeemed for the first time
- **THEN** the action is processed and the token is marked used; any further redemption
  of the same token returns an "already recorded" page and changes nothing

#### Scenario: Expired or invalid token
- **WHEN** an invalid, expired, or unknown token is redeemed
- **THEN** the provider sees a neutral error page; the response for invalid and expired
  tokens is indistinguishable to prevent probing

### Requirement: Response landing flow collects capacity
The system SHALL present a public landing page for a valid token showing the request
brief and, for accept and quote, collect the capacity declaration (number of workers,
available-from date) before recording; decline requires only a reason (optional).

#### Scenario: Provider accepts with capacity
- **WHEN** the provider submits workers and available-from date on the accept/quote
  landing form
- **THEN** a response is recorded through the same path as manual recording and the
  provider sees a confirmation page

#### Scenario: Provider declines
- **WHEN** the provider clicks Decline and optionally submits a reason
- **THEN** a decline response is recorded with `cancelledBy='provider'` attribution on
  the request cancellation when the request has no other responses pending

### Requirement: Automated responses obey outreach rejections
The system SHALL run token-submitted responses through the same rejection rules as
manual recording — closed or cancelled request, duplicate response from the same
company, opted-out company — and present a friendly outcome page instead of an error.

#### Scenario: Response arrives after request closed
- **WHEN** a provider redeems an accept token for a request that is already booked or
  closed
- **THEN** no response is recorded and the page explains the request is no longer open

#### Scenario: Duplicate response
- **WHEN** a company that already responded redeems its token again (e.g. first the
  quote, then a forwarded accept link from the same email)
- **THEN** the second submission is rejected as duplicate and nothing changes

### Requirement: Server-side attribution
The system SHALL derive the responding company and request exclusively from the token
payload server-side; client-submitted data MUST NOT influence which company or request
a response is attributed to.

#### Scenario: Tampered form input
- **WHEN** a malicious client submits a response form with altered company or request
  identifiers
- **THEN** the identifiers are ignored and the response is attributed per the token;
  tampered requests fail validation
