import { Role } from '@opslens/contracts';

export interface ActionPermissionSpec {
  resourceType: string;
  allowedRoles: Role[];
}

/**
 * Complete PRD §FR-11.3 Permission Matrix Specification:
 * Maps each API operation to its resource and the roles permitted to execute it.
 */
export const PRD_PERMISSION_MATRIX: Record<string, ActionPermissionSpec> = {
  // Incidents
  createIncident: {
    resourceType: 'Incident',
    allowedRoles: ['worker', 'maintenance', 'supervisor', 'manager', 'admin'],
  },
  listIncidents: {
    resourceType: 'Incident',
    allowedRoles: ['worker', 'maintenance', 'supervisor', 'manager', 'admin'],
  },
  getIncident: {
    resourceType: 'Incident',
    allowedRoles: ['worker', 'maintenance', 'supervisor', 'manager', 'admin'],
  },
  patchIncident: {
    resourceType: 'Incident',
    allowedRoles: ['maintenance', 'supervisor', 'manager', 'admin'], // Denied for worker
  },
  addComment: {
    resourceType: 'Incident',
    allowedRoles: ['worker', 'maintenance', 'supervisor', 'manager', 'admin'],
  },
  mergeIncident: {
    resourceType: 'Incident',
    allowedRoles: ['supervisor', 'manager', 'admin'], // Denied for worker and maintenance
  },
  answerClarification: {
    resourceType: 'Incident',
    allowedRoles: ['worker', 'supervisor', 'manager', 'admin'], // Maintenance cannot answer clarification questions
  },
  getPresignedUploadUrl: {
    resourceType: 'Incident',
    allowedRoles: ['worker', 'maintenance', 'supervisor', 'manager', 'admin'],
  },

  // Dashboard
  getDashboardSummary: {
    resourceType: 'Dashboard',
    allowedRoles: ['maintenance', 'supervisor', 'manager', 'admin'], // Denied for worker
  },
  getHotspots: {
    resourceType: 'Dashboard',
    allowedRoles: ['supervisor', 'manager', 'admin'], // Denied for worker and maintenance
  },

  // Config
  getConfig: {
    resourceType: 'Config',
    allowedRoles: ['supervisor', 'manager', 'admin'], // Denied for worker and maintenance
  },
  updateScoringWeights: {
    resourceType: 'Config',
    allowedRoles: ['manager', 'admin'], // Denied for worker, maintenance, supervisor
  },
  updateSlaPolicies: {
    resourceType: 'Config',
    allowedRoles: ['manager', 'admin'], // Denied for worker, maintenance, supervisor
  },
  getReferenceData: {
    resourceType: 'Config',
    allowedRoles: ['worker', 'maintenance', 'supervisor', 'manager', 'admin'],
  },

  // Recommendation
  getRecommendations: {
    resourceType: 'Recommendation',
    allowedRoles: ['maintenance', 'supervisor', 'manager', 'admin'], // Denied for worker
  },

  // Copilot
  queryCopilot: {
    resourceType: 'Copilot',
    allowedRoles: ['worker', 'maintenance', 'supervisor', 'manager', 'admin'],
  },

  // Admin
  resetDemo: {
    resourceType: 'Admin',
    allowedRoles: ['admin'], // Admin only
  },
  seedDemo: {
    resourceType: 'Admin',
    allowedRoles: ['admin'], // Admin only
  },
};
