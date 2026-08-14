# AI Contracts — Revision D

- Site-native AI Gateway. No public Custom GPT as production intake.
- Structured JSON-schema outputs for record mutation and clarifier selection.
- Model/prompt/schema/policy version on every run.
- User text/images are untrusted evidence, never system/tool instructions.
- Inferences carry confidence + evidence/reason.
- Timeouts/errors preserve draft and degrade gracefully.
- Safety response content is approved policy, not model improvisation.
- AIAdapter isolates model vendor.
