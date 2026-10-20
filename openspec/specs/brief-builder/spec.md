# Brief Builder Specification

## Purpose

AI-assisted drafting of structured request briefs from a project manager's natural-language description, with missing information flagged (never invented), an explicit PM edit-and-approve gate, and a log of the proposal versus the approved final.

## Requirements

### Requirement: Draft a structured brief from natural language
Staff SHALL be able to submit a PM's free-text job description and receive a proposed structured brief covering: work type and scope, location, desired start date and duration, required trade(s), estimated crew size, budget or pricing expectations, materials/equipment responsibilities, and site conditions. Drafting MUST use the Cloudflare Workers AI binding; no external AI APIs are permitted.

#### Scenario: Draft from a sentence
- **WHEN** staff submits "we need an electrical subcontractor for an apartment renovation in Tallinn next month, 3 fitters"
- **THEN** the system returns a structured brief with trade `electrical`, location Tallinn, crew size 3 and a proposed start date, ready for review

### Requirement: Missing information is flagged, never invented
For every brief field the source text does not support, the system MUST mark the field as missing with an empty value — the system MUST NOT fabricate a plausible value. The proposed brief SHALL list the missing fields prominently so staff know what to ask the PM.

#### Scenario: Unsupported fields stay empty
- **WHEN** the source text mentions no budget
- **THEN** the proposed brief's budget field is empty and flagged as missing, and no budget value appears anywhere in the proposal

#### Scenario: Missing list drives follow-up
- **WHEN** a draft is returned with flagged gaps
- **THEN** the gaps are listed so staff can ask the PM for exactly those fields before approval

### Requirement: Approval gate before distribution
A drafted brief MUST NOT create a request, trigger matching or send any outreach until staff have edited and explicitly approved it. Approving the final brief MUST record a `brief_approved` event, distinct from the request's `request_approved` lifecycle transition.

#### Scenario: Draft does nothing until approved
- **WHEN** staff generates a brief and abandons the review screen
- **THEN** no request, outreach or event is created from the unapproved draft

#### Scenario: Approve the edited brief
- **WHEN** staff edits the drafted brief and approves it
- **THEN** a `brief_approved` event is recorded with the final field values, and the approved values pre-fill the new request form

### Requirement: Proposal-versus-final log
The system SHALL store the originally proposed brief alongside the approved final brief, and staff SHALL be able to see which fields the PM's text did not determine versus what staff entered manually during review.

#### Scenario: Review the edits
- **WHEN** staff opens a request that was created from an approved brief
- **THEN** the original proposal and the approved final are both retrievable with the differences visible
