// Recalculates every derived task value using the current rules:
// weight, priority, status and progress for each task, plus project progress.
//
// The script only writes values the derivation rules own, so it is safe to run
// at any time. Set RESET_TASK_WEIGHTS=1 to also reset every leaf task's
// weight to the default of 1 before recalculating (used once when the rules
// were introduced).
const { recalculateProject } = require('../../services/tasks.service');
const { DEFAULT_WEIGHT } = require('../../services/taskDerivation.service');

exports.seed = async function seed(db) {
  const shouldResetWeights = process.env.RESET_TASK_WEIGHTS === '1';
  const projects = await db('projects').select('id');
  const summary = [];

  for (const project of projects) {
    if (shouldResetWeights) {
      // Leaf tasks are the ones nothing points at as a parent.
      const all = await db('tasks').where({ project_id: project.id }).select('id', 'parent_task_id');
      const parentIds = new Set(all.map(task => task.parent_task_id).filter(Boolean));
      const leafIds = all.filter(task => !parentIds.has(task.id)).map(task => task.id);
      if (leafIds.length) {
        await db('tasks').whereIn('id', leafIds).update({ weight: DEFAULT_WEIGHT });
      }
    }

    await recalculateProject(project.id, db);

    const tasks = await db('tasks').where({ project_id: project.id });
    const projectRow = await db('projects').where({ id: project.id }).first();
    summary.push({
      project_id: project.id,
      tasks: tasks.length,
      progress: projectRow ? Number(projectRow.progress) : 0,
      by_priority: tasks.reduce((counts, task) => {
        counts[task.priority] = (counts[task.priority] || 0) + 1;
        return counts;
      }, {}),
      by_status: tasks.reduce((counts, task) => {
        counts[task.status] = (counts[task.status] || 0) + 1;
        return counts;
      }, {})
    });
  }

  console.log('Task derivation recalculated:', JSON.stringify(summary, null, 2));
  return summary;
};
