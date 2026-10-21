const request = require('supertest');
const app = require('../../src/app');
const { taskRules } = require('../../src/config/taskRules');
const { ACCESS_PRESETS } = require('../../src/config/accessPresets');
const {
  priorityForWeight,
  statusForProgress,
  WEIGHT_MIN,
  WEIGHT_MAX
} = require('../../src/config/taskDerivation');

describe('Published task rules', () => {
  test('the endpoint returns the rules the server calculates with', async () => {
    const response = await request(app).get('/api/meta/task-rules');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.rules).toEqual(taskRules());
  });

  test('the published bands match the priority function for every weight', async () => {
    const rules = taskRules();
    for (let weight = WEIGHT_MIN; weight <= WEIGHT_MAX; weight += 0.5) {
      const band = rules.bands.find((candidate) => weight <= candidate.max);
      expect(band).toBeDefined();
      expect(priorityForWeight(weight)).toBe(band.priority);
    }
  });

  test('the published thresholds match the status function', async () => {
    const rules = taskRules();
    const cases = [
      [0, 'todo'],
      [1, 'in_progress'],
      [50, 'in_progress'],
      [99, 'in_progress'],
      [100, 'done']
    ];
    for (const [progress, expected] of cases) {
      expect(statusForProgress(progress)).toBe(expected);
      if (progress <= rules.status.todo.max) expect(expected).toBe('todo');
      else if (progress >= rules.status.done.min) expect(expected).toBe('done');
      else expect(expected).toBe('in_progress');
    }
  });

  test('the rules are versioned so a client can spot a stale copy', () => {
    expect(taskRules().version).toEqual(expect.any(String));
    expect(taskRules().version.length).toBeGreaterThan(0);
  });

  test('the access presets are published with their labels', async () => {
    const response = await request(app).get('/api/meta/access-presets');
    expect(response.status).toBe(200);
    expect(response.body.ok).toBe(true);
    expect(response.body.presets).toHaveLength(4);
    for (const preset of response.body.presets) {
      expect(preset).toEqual(expect.objectContaining({
        key: expect.any(String),
        attribute: expect.any(String),
        label: expect.any(String),
        description: expect.any(String)
      }));
    }
    // The published list matches the server's own definition.
    expect(response.body.presets.map(preset => preset.key)).toEqual(
      Object.values(ACCESS_PRESETS).map(preset => preset.key)
    );
  });
});
