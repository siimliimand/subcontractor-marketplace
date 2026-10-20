# Trade and Region Catalog Specification

## Purpose
A configurable trade and region catalog: adding a trade or region becomes a data
change instead of a deploy, with per-trade pilot minimums and structured provider
coverage — the groundwork for repeating the six-trade playbook elsewhere.

## Requirements

### Requirement: Configurable trade catalog
Trades SHALL live in a catalog seeded with the six pilot trades and their pilot
minimums. Staff SHALL be able to add a trade and deactivate one without a deploy.
Request and provider validation SHALL use the catalog; deactivating a trade SHALL
preserve all historical data while hiding the trade from new selections. When the
catalog is empty the system SHALL fall back to the built-in pilot trades so the
platform never loses its trade vocabulary.

#### Scenario: New trade added without deploy
- **WHEN** staff adds a trade "demolition" with a pilot minimum to the catalog
- **THEN** new requests and provider services can select "demolition" immediately and the code's built-in trade list is not consulted

#### Scenario: Deactivation preserves history
- **WHEN** staff deactivates a trade that appears on past requests and services
- **THEN** historical records remain intact and queryable, but the trade no longer appears in selection lists for new records

### Requirement: Region catalog and provider coverage
Regions SHALL live in a catalog, and a provider company SHALL be able to declare
the regions it covers. Coverage SHALL be visible on provider views and SHALL be
removable. Companies without declared coverage SHALL remain eligible everywhere.

#### Scenario: Provider declares coverage
- **WHEN** staff records that a provider covers "harju" and "tartu"
- **THEN** the provider's view shows those regions and matching data includes the coverage

### Requirement: Requests may declare a region
A request SHALL be able to carry an optional region from the catalog, validated on
creation and visible on request views. Absence of a region SHALL be valid and
leave matching behaviour unchanged.

#### Scenario: Region validated against catalog
- **WHEN** a request is created with a region that is not in the catalog
- **THEN** the creation is rejected with an explicit error naming the valid options
