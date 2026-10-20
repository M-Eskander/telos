const { priorityForWeight, statusForProgress, WEIGHT_MIN, WEIGHT_MAX } = require('../config/taskDerivation');

const DEFAULT_WEIGHT = 1;

function normalizeWeight(weight) {
  if (weight === null || weight === undefined || weight === '') return DEFAULT_WEIGHT;
  const value = Number(weight);
  if (!Number.isFinite(value)) return DEFAULT_WEIGHT;
  return Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, value));
}

function clampProgress(progress) {
  const value = Number(progress);
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

// Turns a flat task list into a nested tree. A task whose parent is missing is
// treated as a root so nothing is silently dropped.
function buildTaskTree(tasks) {
  const nodes = new Map();
  for (const task of tasks) {
    nodes.set(task.id, { ...task, children: [] });
  }
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.parent_task_id ? nodes.get(node.parent_task_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byId = (a, b) => Number(a.id) - Number(b.id);
  for (const node of nodes.values()) node.children.sort(byId);
  roots.sort(byId);
  return roots;
}

// Derives weight, progress, priority and status for every node, bottom-up.
//
//   leaf      -> weight is the value set by the team, progress is their input
//   parent    -> weight is the average of its children's weights
//                progress is the weighted average of its children's progress
//                (children with a weight of zero do not count)
//   priority  -> the band the weight falls into
//   status    -> derived from the progress
//
// The source column values are preserved so callers can detect what changed.
function deriveTree(roots) {
  const visit = (node) => {
    const children = (node.children || []).map(visit);
    let weight;
    let progress;
    if (children.length) {
      const average = children.reduce((sum, child) => sum + child.derivedWeight, 0) / children.length;
      // The column holds two decimals, so the average is stored the same way.
      weight = Math.round(average * 100) / 100;
      const counted = children.filter(child => child.derivedWeight > 0);
      const totalWeight = counted.reduce((sum, child) => sum + child.derivedWeight, 0);
      progress = totalWeight > 0
        ? Math.round(counted.reduce((sum, child) => sum + child.derivedProgress * child.derivedWeight, 0) / totalWeight)
        : 0;
    } else {
      weight = normalizeWeight(node.weight);
      progress = clampProgress(node.progress);
    }
    return {
      ...node,
      children,
      derivedWeight: weight,
      derivedProgress: progress,
      derivedPriority: priorityForWeight(weight),
      derivedStatus: statusForProgress(progress)
    };
  };
  return roots.map(visit);
}

// Flattens a derived tree into a list of every node.
function flattenDerived(roots) {
  const all = [];
  const visit = (node) => {
    all.push(node);
    (node.children || []).forEach(visit);
  };
  roots.forEach(visit);
  return all;
}

// Project progress: the weighted average of the root tasks.
function projectProgress(rootNodes) {
  const counted = rootNodes.filter(root => root.derivedWeight > 0);
  const totalWeight = counted.reduce((sum, root) => sum + root.derivedWeight, 0);
  if (totalWeight <= 0) return 0;
  return Math.round(
    counted.reduce((sum, root) => sum + root.derivedProgress * root.derivedWeight, 0) / totalWeight
  );
}

module.exports = {
  DEFAULT_WEIGHT,
  normalizeWeight,
  clampProgress,
  buildTaskTree,
  deriveTree,
  flattenDerived,
  projectProgress
};
