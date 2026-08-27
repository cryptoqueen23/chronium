// Normalized record/version shapes per docs/ARCHITECTURE.md. Not a frozen schema —
// connectors and adapters fill in what they know and leave the rest null.

export function normalizeVersion({
  id, recordId, capturedAt, source, archiveUrl, originalUrl,
  mimeType, digest, statusCode, extractedTextRef, provenance
} = {}) {
  return {
    id: id || null,
    recordId: recordId || null,
    capturedAt: capturedAt || null,
    source: source || null,
    archiveUrl: archiveUrl || null,
    originalUrl: originalUrl || null,
    mimeType: mimeType || null,
    digest: digest || null,
    statusCode: statusCode || null,
    extractedTextRef: extractedTextRef || null,
    provenance: provenance || null
  };
}

export function normalizeRecord({
  id, canonicalKey, domain, organization, jurisdiction, category, title,
  description, documentType, originalUrl, currentUrl, firstSeen, lastSeen,
  tags, entities, relatedRecordIds, sourceType, sourceAuthority, provenance,
  versions
} = {}) {
  return {
    id: id || null,
    canonicalKey: canonicalKey || originalUrl || null,
    domain: domain || null,
    organization: organization || null,
    jurisdiction: jurisdiction || null,
    category: category || null,
    title: title || null,
    description: description || null,
    documentType: documentType || null,
    originalUrl: originalUrl || null,
    currentUrl: currentUrl || null,
    firstSeen: firstSeen || null,
    lastSeen: lastSeen || null,
    tags: tags || [],
    entities: entities || [],
    relatedRecordIds: relatedRecordIds || [],
    sourceType: sourceType || null,
    sourceAuthority: sourceAuthority || null,
    provenance: provenance || null,
    versions: versions || []
  };
}
