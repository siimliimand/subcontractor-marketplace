## ADDED Requirements

### Requirement: Automated responses share the manual response path
Responses arriving via email tokens SHALL be recorded through the same response model
and state machine as manually recorded responses, writing their funnel events
(`response_received`, `qualified_response`, `quote_submitted` where applicable) in the
same D1 batch as the state change, with `channel='automated'`.

#### Scenario: Token response moves the funnel
- **WHEN** a provider submits a qualified acceptance via a valid token
- **THEN** the request history shows the response with channel automated and the
  dashboard counts it in qualified-response metrics identically to a manual entry

#### Scenario: No state-machine bypass
- **WHEN** a token response arrives for a request in `draft` or `approved` state
- **THEN** the response is stored but does not move the request through any transition
  that manual recording could not make from that state
