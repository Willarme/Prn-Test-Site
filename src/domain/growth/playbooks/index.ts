import type { ServicePlaybook } from "@/domain/growth/service-playbook";
import { validatePlaybook } from "@/domain/growth/service-playbook";
import { GRAPH_V1_NODE_IDS } from "@/domain/growth/graph-v1";
import { TREE_PLAYBOOK } from "@/domain/growth/playbooks/tree";
import { PLUMBING_DRAIN_PLAYBOOK } from "@/domain/growth/playbooks/plumbing-drain";
import { ROOFING_PLAYBOOK } from "@/domain/growth/playbooks/roofing";

/**
 * PLAYBOOK REGISTRY — the one place a playbook is loaded from. Code reads
 * playbooks through this module, never by importing a playbook file directly,
 * so the one-authoritative-trade-per-trade invariant is enforced in exactly
 * one spot and cannot be bypassed by accident.
 *
 * WHO IS AUTHORITATIVE (Josh's ruling R1, 2026-08-28): TREE, and only Tree.
 * It was the trade authored in full, so it is the trade that becomes the voice
 * of record. Plumbing/Drain and Roofing stay SHADOW — that literal word, not
 * "parked" — and keep provenance.reviewed_by null.
 *
 * Flipping any further playbook to "authoritative" is a data edit PLUS Josh's
 * ruling PLUS a named human with a date in provenance — and this registry's
 * parse refuses an authoritative playbook whose reviewed_by is null, so the
 * ruling cannot be skipped silently.
 */

const ALL_PLAYBOOKS: readonly ServicePlaybook[] = [
  TREE_PLAYBOOK,
  PLUMBING_DRAIN_PLAYBOOK,
  ROOFING_PLAYBOOK,
];

/** Validation errors across the whole registry, plus the one-authoritative-per-trade rule. */
export function validateRegistry(): string[] {
  const errors: string[] = [];
  const authoritative = new Map<string, string>();
  const seenIds = new Set<string>();
  for (const pb of ALL_PLAYBOOKS) {
    if (seenIds.has(pb.playbook_id)) errors.push(`duplicate playbook id: ${pb.playbook_id}`);
    seenIds.add(pb.playbook_id);
    errors.push(...validatePlaybook(pb, GRAPH_V1_NODE_IDS));
    if (pb.status === "authoritative") {
      const existing = authoritative.get(pb.system);
      if (existing !== undefined) {
        errors.push(`two authoritative playbooks for ${pb.system}: ${existing} and ${pb.playbook_id}`);
      }
      authoritative.set(pb.system, pb.playbook_id);
    }
  }
  return errors;
}

const REGISTRY_ERRORS = validateRegistry();
if (REGISTRY_ERRORS.length > 0) {
  throw new Error(`playbook registry failed validation: ${REGISTRY_ERRORS.join("; ")}`);
}

export const PLAYBOOK_REGISTRY: readonly ServicePlaybook[] = ALL_PLAYBOOKS;

/**
 * The playbook allowed to feed PUBLIC page generation for a system, or null.
 * Today: the Tree playbook for "tree", null for every other trade, because
 * only Tree carries a ruling and a signature.
 */
export function authoritativePlaybookFor(system: ServicePlaybook["system"]): ServicePlaybook | null {
  const found = ALL_PLAYBOOKS.find((pb) => pb.system === system && pb.status === "authoritative");
  return found ?? null;
}

/**
 * The AUTHORITATIVE playbook that covers a specific problem-graph node, or null.
 *
 * This is the registry's answer to "does authored content exist for this?" —
 * the question the PageEligibilityGate used to take on trust from its caller
 * (Josh's ruling R5, 2026-08-28). A shadow playbook covering the node answers
 * NO: shadow content is not content a public page may draw on, and pretending
 * otherwise is how a shadow playbook goes live by accident.
 */
export function authoritativePlaybookForNode(nodeId: string): ServicePlaybook | null {
  const found = ALL_PLAYBOOKS.find(
    (pb) => pb.status === "authoritative" && pb.covers_node_ids.includes(nodeId),
  );
  return found ?? null;
}
