# #22A Compatibility — Revision D

## Required now
CapabilityDefinition/Version, EvidenceObject, FactClaim, DerivationRecord, DataRightsRecord, ExecutionContext, centralized authorization, ActionRequest/Attempt/idempotency, ExternalAgentClient/AgentToolDefinition, typed machine API, safe/internal MCP V1, provenance, no-screen E2E, A36 ReadinessCheck, A25 TransitionSignal.

## Safe trial scopes
public.guidance.read; property.own.read/write; problem.own.read/write; trust.own.read; trust.request.send; trust.home_person.write; provider.recommendation.read.

## Future disabled
provider offers/dispatch, schedule, quote accept, payment, purchasing/tool rental. Registering future contract is allowed; executing it is not.

## Hard rule
Web/API/MCP/agents call the same domain services. Adapters never own business logic or direct-table private decision logic.
