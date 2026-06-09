import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  normalizeEmail,
  bootstrapAdminEmails,
  isBootstrapAdmin,
  shouldAllowSignup,
} from './invites';

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
  });
});

describe('bootstrapAdminEmails', () => {
  const prev = process.env.BOOTSTRAP_ADMIN_EMAILS;
  afterEach(() => { process.env.BOOTSTRAP_ADMIN_EMAILS = prev; });

  it('returns [] when unset', () => {
    delete process.env.BOOTSTRAP_ADMIN_EMAILS;
    expect(bootstrapAdminEmails()).toEqual([]);
  });

  it('parses a normalized csv', () => {
    process.env.BOOTSTRAP_ADMIN_EMAILS = ' A@x.com , b@Y.com ,';
    expect(bootstrapAdminEmails()).toEqual(['a@x.com', 'b@y.com']);
  });
});

describe('isBootstrapAdmin', () => {
  beforeEach(() => { process.env.BOOTSTRAP_ADMIN_EMAILS = 'owner@x.com'; });
  afterEach(() => { delete process.env.BOOTSTRAP_ADMIN_EMAILS; });

  it('matches case-insensitively', () => {
    expect(isBootstrapAdmin('Owner@X.com')).toBe(true);
    expect(isBootstrapAdmin('someone@x.com')).toBe(false);
  });
});

describe('shouldAllowSignup', () => {
  beforeEach(() => { process.env.BOOTSTRAP_ADMIN_EMAILS = 'owner@x.com'; });
  afterEach(() => { delete process.env.BOOTSTRAP_ADMIN_EMAILS; });

  it('allows bootstrap admin even without an invite', () => {
    expect(shouldAllowSignup({ email: 'owner@x.com', hasPendingInvite: false })).toBe(true);
  });
  it('allows an invited non-admin', () => {
    expect(shouldAllowSignup({ email: 'guest@x.com', hasPendingInvite: true })).toBe(true);
  });
  it('rejects an uninvited non-admin', () => {
    expect(shouldAllowSignup({ email: 'stranger@x.com', hasPendingInvite: false })).toBe(false);
  });
});
