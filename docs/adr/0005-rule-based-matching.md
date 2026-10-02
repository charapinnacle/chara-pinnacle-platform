# ADR-0005: Rule-based, explainable matching

- Status: Accepted (applies to a later phase; nothing is built in Phase 1)
- Date: 2026-10-02

## Context

CHARA Match will rank workers and partner companies against a hiring need. Ranking people for work falls in the area that the EU AI Act treats as high-risk when an AI system does it, and GDPR Article 22 restricts decisions based solely on automated processing. The product also promises that boosts and payments never change organic results.

Phase 1 does not include matching, but the schema must stay ready for it, so the approach is fixed now.

## Decision

1. Matching is deterministic and rule-based: a SQL function (`public.chara_match`) scores candidates with weights read from a rules table (`match_rules`: rule key, entity type, weight, enabled). No machine learning in v1.
2. Every result stores why it matched. Each rule contribution is appended as `{rule, points, detail}` and persisted in `match_results.reasons`, declared `jsonb not null`. Runs are logged in `match_runs`, and the UI shows the reasons to the user.
3. The rules and weights are documented. Verification may be a filter and a weighted rule; boosts never enter the score.
4. Introducing AI-based matching requires a data protection impact assessment and a new ADR that supersedes this one.

## Consequences

Benefits:

- Results are reproducible and explainable to workers, companies and regulators; the same inputs and weights give the same output.
- Weights are rows, so tuning does not need a code deployment.
- The design is intended to keep matching outside the EU AI Act high-risk category and outside solely automated decision-making. This is a design posture, not a legal assessment.

Costs:

- Match quality is limited to structured fields (occupation, skills, work authorization, availability, languages, geography) and hand-chosen weights. Free text is not interpreted and nothing is learned from outcomes.
- Weights have to be chosen, reviewed and re-tuned by people, with tests for each rule.
- Persisting a result row with reasons for every run adds storage and write cost.
- Phase 1 carries the supporting structure (coded occupations and skills, structured work authorization and availability) without delivering matching.
- Results are written to `match_results`, so a separate matching service could later replace the SQL function, subject to point 4.
