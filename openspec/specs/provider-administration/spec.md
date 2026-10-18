# Provider Administration Specification

## Purpose
Define how staff create and manage provider companies in the cockpit, including their trades-restricted services, unique registration identifiers, status lifecycle (including opt-out), and filtered listing.

## Requirements

### Requirement: Create provider company
Staff SHALL be able to create a provider company with a legal name, registration identifier, contact email, contact phone, and an initial status (`active`, `inactive`, or `opted_out`). The company then appears in the provider list.

#### Scenario: Create with required fields
- **WHEN** staff submits a new provider with legal name, registration identifier and contact email
- **THEN** the provider is stored with status `active` and appears in the provider list

#### Scenario: Missing required field
- **WHEN** staff submits a provider without a contact email
- **THEN** the system rejects the submission and no provider is created

### Requirement: Registration identifier uniqueness
A provider's registration identifier (Äriregister number) MUST be unique across providers.

#### Scenario: Duplicate registration identifier
- **WHEN** staff submits a provider whose registration identifier already exists
- **THEN** the system rejects the submission and identifies the existing provider

### Requirement: Trade-restricted services
Each provider service SHALL specify a trade that MUST belong to the configured trades list (pilot: electrical, plumbing, HVAC, drywall, flooring, painting), plus skills, service area, pricing approach and a pricing model that MUST be one of `hour`, `m2`, `project`.

#### Scenario: Valid service
- **WHEN** staff adds a service with trade `electrical`, a service area and pricing model `m2`
- **THEN** the service is stored on the provider profile

#### Scenario: Invalid trade or pricing model
- **WHEN** staff adds a service with a trade or pricing model outside the configured values
- **THEN** the system rejects it with a validation error naming the allowed values

### Requirement: Provider status lifecycle
Staff SHALL be able to change provider status between `active`, `inactive` and `opted_out`. Each change MUST record a timestamp and reason, and `opted_out` MUST exclude the provider from any future outreach candidate selection.

#### Scenario: Opt out
- **WHEN** staff marks a provider `opted_out` with a reason
- **THEN** the provider's profile remains for history but the provider can no longer be added to outreach

### Requirement: Provider list and filtering
Staff SHALL be able to list providers filtered by trade, status and service area, and search by name.

#### Scenario: Filter by trade and status
- **WHEN** staff filters the provider list by trade `plumbing` and status `active`
- **THEN** only active providers offering plumbing services are shown
