import { expect, it } from 'vitest';
import { buildVPQuery, readVPOptions } from './options';

it('round-trips the team organization through contest links', () => {
  const options = readVPOptions({ team: ' My team ', organization: ' 东北大学 ' });
  const query = buildVPQuery('icpc2025invitational-xi_an', options);
  expect(query).toMatchObject({ team: 'My team', organization: '东北大学' });
  expect(readVPOptions(query)).toMatchObject({ team: 'My team', organization: '东北大学' });
});

it('keeps existing team links working without an organization', () => {
  const options = readVPOptions({ team: 'My team' });
  expect(options.organization).toBe('');
  expect(buildVPQuery('test', options)).not.toHaveProperty('organization');
});
