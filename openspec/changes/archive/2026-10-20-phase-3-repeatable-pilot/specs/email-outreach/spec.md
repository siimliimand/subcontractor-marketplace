# Spec Delta

## Purpose

Give staff direct control of the suppression list beyond automatic bounce handling: manual add/remove/list with reasons, all audited, so GDPR objections and "stop emailing me" requests are handled deliberately.

## ADDED Requirements

### Requirement: Manual suppression management
Staff SHALL be able to add an address to the suppression list (with reason), remove
an entry (with reason), and list current entries with their reasons and origins
(bounce or manual). Every change SHALL be audit-logged with the staff actor.

#### Scenario: Provider asks to stop emails
- **WHEN** staff adds an address with reason "provider request"
- **THEN** all send paths skip that address with the entry visibly marked skipped,
  and the addition is audited

#### Scenario: Wrongful suppression corrected
- **WHEN** staff removes a manually-added suppression with a reason
- **THEN** the address becomes sendable again and the removal is audited
