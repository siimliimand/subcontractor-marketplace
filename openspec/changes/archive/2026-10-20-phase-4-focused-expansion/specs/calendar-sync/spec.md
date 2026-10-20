# Spec Delta

## Purpose

Provider calendar feeds: staff register secret Google/Outlook ICS URLs per provider company; an hourly fetch converts feed events into busy intervals so bookings respect real calendars, with explicit conflict surfacing and staleness handling.

## ADDED Requirements

### Requirement: Secret ICS feed registration
Staff SHALL be able to register an ICS feed URL for a provider company, up to a
configured maximum per company, and remove it. Feed URLs SHALL be treated as
secrets: responses mask them, logs never contain them, and registration or removal
is audit-logged. A company without feeds behaves exactly as before.

#### Scenario: Staff registers a Google Calendar secret ICS address
- **WHEN** staff submits a valid `https://…/basic.ics` URL for a provider company
- **THEN** the feed is stored and listed with a masked URL (e.g. `https://…/basic.ics` truncated with a fixed suffix marker), and a `calendar_feed_added` audit event records the actor

#### Scenario: Feed limit enforced
- **WHEN** staff attempts to register more feeds than the configured maximum for one company
- **THEN** the request is rejected with an explicit error and no feed is stored

### Requirement: Hourly fetch into busy intervals
The scheduled job SHALL fetch every active feed, parse its events into busy
intervals within a bounded forward window, and replace that feed's stored
intervals on success. A feed whose fetch or parse fails SHALL keep its previously
imported intervals and record the failure; repeated failures back off instead of
hammering the calendar host.

#### Scenario: Successful fetch replaces intervals
- **WHEN** a feed is fetched successfully and contains two events inside the forward window
- **THEN** exactly those two busy intervals are stored for the feed, replacing any earlier intervals from that feed

#### Scenario: Failed fetch preserves last good data
- **WHEN** a feed fetch fails or returns unparseable content
- **THEN** the feed's existing intervals remain in place, the failure is recorded on the feed, and unparseable events are counted rather than silently dropped

### Requirement: Bookings respect imported busy intervals
Creating, confirming, or widening a booking into a time range that overlaps an
imported busy interval SHALL be rejected with an explicit calendar-conflict
reason, regardless of what capacity declarations say — the calendar is the
stronger signal. Conflict responses SHALL NOT expose feed event details, only
that the provider's calendar is busy.

#### Scenario: Declaration free but calendar busy
- **WHEN** a provider declared capacity for a day but the imported calendar has a busy interval overlapping the requested slot
- **THEN** the booking request or widening is rejected with a calendar-conflict reason distinct from the capacity-declaration reason

#### Scenario: No feeds means no new blocks
- **WHEN** a provider has no registered feeds
- **THEN** booking behaviour is identical to the pre-calendar behaviour

### Requirement: Stale feeds are flagged, not silently trusted
A feed not successfully fetched within the configured staleness window SHALL be
flagged stale in staff views while its intervals continue to block conservatively.
Removing a feed or erasing the company SHALL purge its intervals.

#### Scenario: Feed goes stale
- **WHEN** a feed has had no successful fetch for longer than the staleness window
- **THEN** staff views flag the feed as stale with the last successful fetch time, and its intervals still block bookings

#### Scenario: Feed removal purges derived data
- **WHEN** staff removes a feed
- **THEN** its stored busy intervals are deleted and the removal is audit-logged
