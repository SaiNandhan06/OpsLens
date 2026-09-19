export interface RouteMapping {
  action: string;
  resourceType: 'Incident' | 'Dashboard' | 'Config' | 'Recommendation' | 'Copilot' | 'Admin';
}

/**
 * Maps an incoming HTTP method and request path to the corresponding Cedar Action and Resource.
 */
export function mapRouteToAction(method: string, path: string): RouteMapping {
  const m = method.toUpperCase();
  // Strip query parameters, trailing slashes, and optional /v1 API prefix
  const rawPath = path.split('?')[0]!.replace(/\/+$/, '') || '/';
  const cleanPath = rawPath.startsWith('/v1') ? rawPath.slice(3) || '/' : rawPath;

  if (m === 'POST' && cleanPath === '/incidents') {
    return { action: 'createIncident', resourceType: 'Incident' };
  }
  if (m === 'GET' && cleanPath === '/incidents') {
    return { action: 'listIncidents', resourceType: 'Incident' };
  }
  if (m === 'POST' && cleanPath.endsWith('/comments')) {
    return { action: 'addComment', resourceType: 'Incident' };
  }
  if (m === 'POST' && cleanPath.endsWith('/merge')) {
    return { action: 'mergeIncident', resourceType: 'Incident' };
  }
  if (m === 'POST' && cleanPath.endsWith('/answer')) {
    return { action: 'answerClarification', resourceType: 'Incident' };
  }
  if (m === 'GET' && /^\/incidents\/[^/]+$/.test(cleanPath)) {
    return { action: 'getIncident', resourceType: 'Incident' };
  }
  if (m === 'PATCH' && /^\/incidents\/[^/]+$/.test(cleanPath)) {
    return { action: 'patchIncident', resourceType: 'Incident' };
  }
  if (m === 'POST' && cleanPath === '/uploads/presign') {
    return { action: 'getPresignedUploadUrl', resourceType: 'Incident' };
  }

  // Dashboard
  if (m === 'GET' && cleanPath === '/dashboard/summary') {
    return { action: 'getDashboardSummary', resourceType: 'Dashboard' };
  }
  if (m === 'GET' && cleanPath === '/dashboard/hotspots') {
    return { action: 'getHotspots', resourceType: 'Dashboard' };
  }

  // Config
  if (m === 'GET' && cleanPath === '/config') {
    return { action: 'getConfig', resourceType: 'Config' };
  }
  if (m === 'PUT' && cleanPath === '/config/scoring-weights') {
    return { action: 'updateScoringWeights', resourceType: 'Config' };
  }
  if (m === 'PUT' && cleanPath === '/config/sla-policies') {
    return { action: 'updateSlaPolicies', resourceType: 'Config' };
  }
  if (m === 'GET' && cleanPath === '/config/reference-data') {
    return { action: 'getReferenceData', resourceType: 'Config' };
  }

  // Recommendations
  if (m === 'GET' && cleanPath === '/recommendations') {
    return { action: 'getRecommendations', resourceType: 'Recommendation' };
  }

  // Copilot
  if (m === 'POST' && cleanPath === '/copilot/query') {
    return { action: 'queryCopilot', resourceType: 'Copilot' };
  }

  // Admin
  if (m === 'POST' && cleanPath === '/admin/reset') {
    return { action: 'resetDemo', resourceType: 'Admin' };
  }
  if (m === 'POST' && cleanPath === '/admin/seed') {
    return { action: 'seedDemo', resourceType: 'Admin' };
  }

  // Default fallback
  return { action: `${m.toLowerCase()}_unknown`, resourceType: 'Incident' };
}
