// Pure-function tests for the Sponsors & Partners data model. No I/O.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARTNERS,
  ECOSYSTEM_SUPPORT,
  PARTNER_TYPES,
  PARTNER_STATUSES,
  validatePartnerRecord,
  findDuplicatePartnerIds,
  getPartnerById,
} from '../../src/mole/partnersData.js';

describe('partnersData: seeded data integrity', () => {
  test('every seeded partner record is individually valid', () => {
    for (const partner of PARTNERS) {
      const result = validatePartnerRecord(partner);
      assert.equal(result.ok, true, `${partner.id} failed validation: ${result.errors.join(', ')}`);
    }
  });

  test('no duplicate partner ids exist in the seeded data', () => {
    assert.deepEqual(findDuplicatePartnerIds(), []);
  });

  test('the 2BRZ record exists and is not marked active without current evidence', () => {
    const record = getPartnerById('2brz');
    assert.ok(record);
    assert.notEqual(record.status, PARTNER_STATUSES.ACTIVE);
  });

  test('the 2BRZ record has at least one public evidence link', () => {
    const record = getPartnerById('2brz');
    assert.ok(record.publicEvidence.length > 0);
  });

  test('the 2BRZ record does not claim formal partnership, investment, or endorsement', () => {
    const record = getPartnerById('2brz');
    const claim = record.whatIsNotClaimed.toLowerCase();
    assert.ok(claim.includes('no formal legal partnership'));
    assert.ok(claim.includes('investment'));
    assert.ok(claim.includes('endorsement'));
  });

  test('every ecosystem-support entry has a verification label', () => {
    for (const entry of ECOSYSTEM_SUPPORT) {
      assert.ok(entry.verification, `${entry.id} is missing a verification label`);
    }
  });

  test('the DEX/RugCheck date conflict is documented, not silently resolved', () => {
    const entry = ECOSYSTEM_SUPPORT.find((e) => e.id === 'dex-rugcheck-services');
    assert.ok(entry);
    assert.equal(entry.verification, 'conflicting-dates');
    assert.ok(entry.notes.includes('April 24'));
    assert.ok(entry.notes.toLowerCase().includes('august'));
  });

  test('ecosystem-support entries are labeled service providers, not sponsors — no "sponsor" type is misapplied to a vendor', () => {
    for (const entry of ECOSYSTEM_SUPPORT) {
      assert.notEqual(entry.category, PARTNER_TYPES.SPONSOR);
    }
  });
});

describe('partnersData: validatePartnerRecord', () => {
  const validBase = {
    id: 'test-partner',
    name: 'Test Partner',
    type: PARTNER_TYPES.COMMUNITY_PARTNER,
    status: PARTNER_STATUSES.HISTORICAL,
    publicEvidence: [{ label: 'x', url: 'https://example.com' }],
  };

  test('a well-formed record passes', () => {
    assert.equal(validatePartnerRecord(validBase).ok, true);
  });

  test('missing id/name/type/status are all individually caught', () => {
    assert.ok(validatePartnerRecord({ ...validBase, id: '' }).errors.includes('missing_id'));
    assert.ok(validatePartnerRecord({ ...validBase, name: '' }).errors.includes('missing_name'));
    assert.ok(validatePartnerRecord({ ...validBase, type: 'not-a-real-type' }).errors.includes('invalid_type'));
    assert.ok(validatePartnerRecord({ ...validBase, status: 'not-a-real-status' }).errors.includes('invalid_status'));
  });

  test('ACTIVE status with zero evidence links is rejected — the core "no unsupported active claim" rule', () => {
    const result = validatePartnerRecord({ ...validBase, status: PARTNER_STATUSES.ACTIVE, publicEvidence: [] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes('active_status_requires_evidence'));
  });

  test('ACTIVE status WITH evidence links is accepted', () => {
    const result = validatePartnerRecord({ ...validBase, status: PARTNER_STATUSES.ACTIVE });
    assert.equal(result.ok, true);
  });

  test('HISTORICAL/STATUS_UNCONFIRMED status never requires evidence to pass basic validation', () => {
    assert.equal(validatePartnerRecord({ ...validBase, status: PARTNER_STATUSES.STATUS_UNCONFIRMED, publicEvidence: [] }).ok, true);
  });
});

describe('partnersData: findDuplicatePartnerIds', () => {
  test('detects a real duplicate id', () => {
    const partners = [{ id: 'a' }, { id: 'b' }, { id: 'a' }];
    assert.deepEqual(findDuplicatePartnerIds(partners), ['a']);
  });

  test('empty/unique lists produce no duplicates', () => {
    assert.deepEqual(findDuplicatePartnerIds([]), []);
    assert.deepEqual(findDuplicatePartnerIds([{ id: 'a' }, { id: 'b' }]), []);
  });
});

describe('partnersData: getPartnerById', () => {
  test('returns null for an unknown id, not undefined or a throw', () => {
    assert.equal(getPartnerById('does-not-exist'), null);
  });
});
