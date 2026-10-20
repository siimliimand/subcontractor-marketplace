## ADDED Requirements

### Requirement: Email channel and delivery states on outreach entries
Outreach entries SHALL carry the outreach channel including `email`, and for email
entries a delivery status (`sent`, `delivered`, `bounced`, `opened`, `skipped`) updated
from lifecycle events, so the cockpit shows which providers were contacted and whether
the email reached them.

#### Scenario: Cockpit shows delivery status
- **WHEN** staff views a request's outreach panel after a batch send
- **THEN** each entry shows provider, batch, and its email delivery status with
  timestamps from the audit trail

#### Scenario: Manual outreach unchanged
- **WHEN** staff logs phone or other outreach manually
- **THEN** the entry records `channel='manual'` with no delivery lifecycle, exactly as
  before
