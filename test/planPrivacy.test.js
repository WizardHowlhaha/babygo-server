'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { approximateCoordinate, distanceMeters, shapePlan } = require('../src/services/planPrivacy');

function planRow() {
  return {
    id: 42,
    owner_id: 1,
    nickname: '发起人',
    avatar: '',
    is_verified: false,
    title: '公园遛娃',
    activity_kind: 'pet',
    summary: '周末见',
    starts_at: new Date('2026-08-20T02:00:00Z'),
    duration_minutes: 90,
    participant_limit: 4,
    approximate_place: '公园附近',
    private_meeting_point: '南门入口',
    shared_toys: ['篮球', '泡泡机'],
    shared_pets: ['狗'],
    latitude: 31.215234,
    longitude: 121.551345,
    visibility: 0,
    accepted_count: '2',
    distance_meters: '1234.4',
    status: 1,
    my_member_status: null,
    created_at: new Date('2026-08-17T00:00:00Z'),
  };
}

test('public coordinates are stable and do not expose the precise coordinate', () => {
  const first = approximateCoordinate(42, 31.215234, 121.551345);
  const second = approximateCoordinate(42, 31.215234, 121.551345);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, { latitude: 31.215234, longitude: 121.551345 });
  assert.ok(Math.abs(first.latitude - 31.215234) < 0.02);
  assert.ok(Math.abs(first.longitude - 121.551345) < 0.02);
});

test('non-members receive redacted location and rounded distance', () => {
  const shaped = shapePlan(planRow(), 2, false);
  assert.equal(shaped.privateMeetingPoint, null);
  assert.notEqual(shaped.latitude, 31.215234);
  assert.notEqual(shaped.longitude, 121.551345);
  assert.equal(shaped.distanceMeters, 1000);
});

test('accepted members receive precise location', () => {
  const shaped = shapePlan(planRow(), 2, true);
  assert.equal(shaped.privateMeetingPoint, '南门入口');
  assert.equal(shaped.activityKind, 'pet');
  assert.deepEqual(shaped.sharedToys, ['篮球', '泡泡机']);
  assert.deepEqual(shaped.sharedPets, ['狗']);
  assert.equal(shaped.latitude, 31.215234);
  assert.equal(shaped.longitude, 121.551345);
  assert.equal(shaped.distanceMeters, 1234);
});

test('unlimited plans expose a null participant limit', () => {
  const shaped = shapePlan({ ...planRow(), participant_limit: null }, 2, true);
  assert.equal(shaped.participantLimit, null);
});

test('public distance is derived from the approximate coordinate', () => {
  const coordinate = approximateCoordinate(42, 31.215234, 121.551345);
  const distance = distanceMeters(31.200000, 121.540000, coordinate.latitude, coordinate.longitude);
  assert.ok(distance > 0);
  const shaped = shapePlan({ ...planRow(), distance_meters: distance }, 2, false);
  assert.equal(shaped.distanceMeters % 500, 0);
});
