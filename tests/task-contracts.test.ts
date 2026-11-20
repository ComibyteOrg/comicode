import { describe, expect, it } from 'vitest';
import {
  closeContract,
  createStageContracts,
  type TaskContract,
} from '../src/core/agent/task-contract.js';

describe('task contracts', () => {
  it('creates one contract per stage with dependency chains', () => {
    const contracts = createStageContracts(['plan', 'frontend', 'backend'], 'build a site');
    expect(contracts).toHaveLength(3);
    expect(contracts[0]!.dependencies).toEqual([]);
    expect(contracts[1]!.dependencies).toEqual([contracts[0]!.id]);
    expect(contracts[2]!.dependencies).toEqual([contracts[1]!.id]);
    expect(contracts.every((c) => c.status === 'ready')).toBe(true);
  });

  it('assigns the right agent for each role', () => {
    const contracts = createStageContracts(['database', 'mobile'], 'build an app');
    expect(contracts[0]!.assignee).toBe('database');
    expect(contracts[1]!.assignee).toBe('mobile');
  });

  it('closes a contract only with a real result', () => {
    const contract = createStageContracts(['qa'], 'test')[0]!;
    const done = closeContract(contract, '24 tests passed', true);
    expect(done.status).toBe('completed');
    expect(done.actualResult).toBe('24 tests passed');
    const failed = closeContract(contract, 'suite failed', false);
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('suite failed');
  });

  it('never stores unknown secrets in the objective', () => {
    const contracts: TaskContract[] = createStageContracts(['backend'], 'key sk-1234secret');
    expect(JSON.stringify(contracts)).not.toContain('sk-1234secret');
  });
});
