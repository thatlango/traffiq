function incidentLabel(type) {
  return String(type || 'incident')
    .split(/[_-]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('invalid_world_source_timestamp');
  return date.toISOString();
}

export function buildTraffiqWorldBatch(rows, asOf = new Date().toISOString()) {
  const entities = rows
    .map(row => ({
      id: 'traffiq:incident:' + row.id,
      type: 'traffic_incident',
      label: incidentLabel(row.type),
      observedAt: iso(row.updated_at ?? row.occurred_at),
      location: {
        latitude: Number(row.lat),
        longitude: Number(row.lng),
      },
      properties: {
        type: String(row.type),
        severity: String(row.severity),
        status: String(row.status),
        occurredAt: iso(row.occurred_at),
        confirmations: Number(row.confirmations ?? 0),
        disputes: Number(row.disputes ?? 0),
      },
      confidence: {
        level: 'observed',
        basis: 'TraffIQ incident observation; not an enforcement or verified road-authority determination.',
      },
      provenance: [{
        sourceId: 'traffiq',
        sourceLabel: 'TraffIQ',
        fetchedAt: asOf,
        evidenceId: String(row.id),
      }],
    }))
    .sort((a, b) => a.id.localeCompare(b.id));

  const events = rows
    .map(row => ({
      id: 'traffiq:event:incident:' + row.id,
      type: 'traffic.incident.observed',
      occurredAt: iso(row.occurred_at),
      entityIds: ['traffiq:incident:' + row.id],
      properties: {
        type: String(row.type),
        severity: String(row.severity),
        status: String(row.status),
      },
      confidence: {
        level: 'observed',
        basis: 'TraffIQ incident observation.',
      },
      provenance: [{
        sourceId: 'traffiq',
        sourceLabel: 'TraffIQ',
        fetchedAt: asOf,
        evidenceId: String(row.id),
      }],
    }))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));

  return {
    sourceId: 'traffiq',
    asOf,
    entities,
    relations: [],
    events,
  };
}

export function worldIso(value) {
  return iso(value);
}
