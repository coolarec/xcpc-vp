import { expect, it } from 'vitest';
import type * as srk from '@algoux/standard-ranklist';
import { applyVPOptions, buildVPQuery, readVPOptions } from './options';

it('fixes VP penalty at 20 minutes and ignores obsolete penalty URL parameters', () => {
  const source: srk.Ranklist = {
    type: 'general', version: '0.3.14',
    contest: { title: 'Penalty', startAt: '2026-01-01T00:00:00Z', duration: [5, 'h'] },
    problems: [{ alias: 'A' }], series: [], rows: [],
    sorter: { algorithm: 'ICPC', config: { penalty: [7, 'min'] } },
  };
  const options = readVPOptions({ penalty: '7' });
  expect(applyVPOptions(source, options).sorter).toMatchObject({ config: { penalty: [20, 'min'] } });
  expect(buildVPQuery('test', options)).not.toHaveProperty('penalty');
  expect(source.sorter).toMatchObject({ config: { penalty: [7, 'min'] } });
});
