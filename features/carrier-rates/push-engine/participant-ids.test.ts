import { describe, it, expect } from 'vitest';
import { engineParticipantIdsToReplace } from './participant-ids';

describe('engineParticipantIdsToReplace', () => {
  it('chỉ lấy id của participant (engine), bỏ flat manual', () => {
    const ids = engineParticipantIdsToReplace([
      { node: { id: 'gid/1', rateProvider: { __typename: 'DeliveryParticipant' } } },
      { node: { id: 'gid/2', rateProvider: { __typename: 'DeliveryRateDefinition' } } },
      { node: { id: 'gid/3', rateProvider: {} } },
    ]);
    expect(ids).toEqual(['gid/1']);
  });
});
