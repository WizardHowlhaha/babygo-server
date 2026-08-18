'use strict';
const crypto = require('crypto');

function approximateCoordinate(planId, latitude, longitude) {
  if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) return null;
  const digest = crypto.createHash('sha256').update(`babygo-plan-location:${planId}`).digest();
  const latitudeOffset = ((digest[0] / 255) - 0.5) * 0.006;
  const longitudeOffset = ((digest[1] / 255) - 0.5) * 0.006;
  return {
    latitude: Number((Math.round(Number(latitude) * 100) / 100 + latitudeOffset).toFixed(4)),
    longitude: Number((Math.round(Number(longitude) * 100) / 100 + longitudeOffset).toFixed(4)),
  };
}

function distanceMeters(fromLatitude, fromLongitude, toLatitude, toLongitude) {
  const earthRadius = 6_371_000;
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(toLatitude - fromLatitude);
  const longitudeDelta = radians(toLongitude - fromLongitude);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(fromLatitude))
      * Math.cos(radians(toLatitude))
      * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function shapePlan(row, viewerId, canSeePrivateLocation) {
  const isOwner = String(row.owner_id) === String(viewerId);
  const coordinate = canSeePrivateLocation
    ? { latitude: row.latitude, longitude: row.longitude }
    : approximateCoordinate(row.id, row.latitude, row.longitude);
  const distance = row.distance_meters != null ? Number(row.distance_meters) : null;

  return {
    id: String(row.id),
    owner: {
      id: String(row.owner_id),
      nickname: row.nickname,
      avatar: row.avatar,
      isVerified: row.is_verified,
    },
    title: row.title,
    summary: row.summary,
    startsAt: row.starts_at,
    durationMinutes: row.duration_minutes,
    participantLimit: row.participant_limit,
    approximatePlace: row.approximate_place,
    privateMeetingPoint: (isOwner || canSeePrivateLocation) ? row.private_meeting_point : null,
    latitude: coordinate?.latitude ?? null,
    longitude: coordinate?.longitude ?? null,
    visibility: row.visibility,
    acceptedCount: row.accepted_count != null ? Number(row.accepted_count) : undefined,
    distanceMeters: distance == null
      ? undefined
      : (canSeePrivateLocation ? Math.round(distance) : Math.max(500, Math.round(distance / 500) * 500)),
    status: row.status,
    isMine: isOwner,
    myMemberStatus: row.my_member_status != null ? row.my_member_status : null,
    createdAt: row.created_at,
  };
}

module.exports = { approximateCoordinate, distanceMeters, shapePlan };
