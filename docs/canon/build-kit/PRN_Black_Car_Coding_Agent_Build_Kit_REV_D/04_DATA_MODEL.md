# Data Model — Revision D

Required durable objects: Person, Household, PropertyRecordLite, GuestSession, Request, ProblemRecord, EvidenceObject, FactClaim, DerivationRecord, JobPacket/Version, TrustRequest, TrustResponse, TrustEdge, HomePerson, ProviderEntity, ProviderExternalId, ProviderAlias, ProviderEvidence, ProviderRecommendation, DisclosureVersion, ConsentEvent, DataRightsRecord, SearchOpportunity, PageSpec/PageVersion, FeatureConcept/InterestEvent, EventEnvelope, MetricDefinition, CapabilityDefinition/Version, ActionRequest/Attempt, ExternalAgentClient, AgentToolDefinition, AgentRun, ReadinessCheck, TransitionSignal, AuditEvent.

Reserve OutcomeRecord/QuoteRecord as future-compatible schema only.

ProviderEntity must support entity_kind organization|branch|individual and parent_provider_id.
