import { describe, it, expect } from 'vitest';
import {
  buildWebPresenceInput, WEB_PRESENCE_CREATE_MUTATION, WEB_PRESENCE_UPDATE_MUTATION,
} from './languages';

describe('buildWebPresenceInput', () => {
  it('builds input with default + alternates', () => {
    expect(buildWebPresenceInput('en', ['de', 'fr'], 'us-store')).toEqual({
      defaultLocale: 'en',
      alternateLocales: ['de', 'fr'],
      subfolderSuffix: 'us-store',
    });
  });

  it('builds input with default only when no alternates', () => {
    expect(buildWebPresenceInput('en', [], 'us-store')).toEqual({
      defaultLocale: 'en',
      alternateLocales: [],
      subfolderSuffix: 'us-store',
    });
  });
});

describe('web presence mutations', () => {
  it('CREATE is a marketWebPresenceCreate mutation', () => {
    expect(WEB_PRESENCE_CREATE_MUTATION).toContain('marketWebPresenceCreate');
  });
  it('UPDATE is a marketWebPresenceUpdate mutation', () => {
    expect(WEB_PRESENCE_UPDATE_MUTATION).toContain('marketWebPresenceUpdate');
  });
});
