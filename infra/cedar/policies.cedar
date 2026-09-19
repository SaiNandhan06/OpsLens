// Explicit Forbid: cross-tenant access is strictly forbidden and cannot be overridden by any permit
@id("policy_forbid_cross_tenant")
forbid (
  principal,
  action,
  resource
)
when {
  principal.tenantId != resource.tenantId
};

// Admin: full access to everything within tenant
@id("policy_permit_admin")
permit (
  principal,
  action,
  resource
)
when {
  principal.role == "admin"
};

// Manager: full access to incidents, dashboard, config, recommendations, copilot
@id("policy_permit_manager")
permit (
  principal,
  action,
  resource
)
when {
  principal.role == "manager" &&
  (resource is OpsLens::Incident ||
   resource is OpsLens::Dashboard ||
   resource is OpsLens::Config ||
   resource is OpsLens::Recommendation ||
   resource is OpsLens::Copilot)
};

// Supervisor: all incident operations, dashboard (summary + hotspots), recommendations, read config & reference, copilot query
@id("policy_permit_supervisor")
permit (
  principal,
  action,
  resource
)
when {
  principal.role == "supervisor" &&
  (
    resource is OpsLens::Incident ||
    resource is OpsLens::Dashboard ||
    resource is OpsLens::Recommendation ||
    resource is OpsLens::Copilot ||
    (resource is OpsLens::Config &&
     (action == OpsLens::Action::"getConfig" || action == OpsLens::Action::"getReferenceData"))
  )
};

// Maintenance: incident operations except merge & clarification; dashboard summary; recommendations; reference data; copilot
@id("policy_permit_maintenance")
permit (
  principal,
  action,
  resource
)
when {
  principal.role == "maintenance" &&
  (
    (resource is OpsLens::Incident &&
     (action == OpsLens::Action::"createIncident" ||
      action == OpsLens::Action::"listIncidents" ||
      action == OpsLens::Action::"getIncident" ||
      action == OpsLens::Action::"patchIncident" ||
      action == OpsLens::Action::"addComment" ||
      action == OpsLens::Action::"getPresignedUploadUrl")) ||
    (resource is OpsLens::Dashboard && action == OpsLens::Action::"getDashboardSummary") ||
    resource is OpsLens::Recommendation ||
    resource is OpsLens::Copilot ||
    (resource is OpsLens::Config && action == OpsLens::Action::"getReferenceData")
  )
};

// Worker: report/read incident, comment, answer clarification, upload media; read reference data; query copilot
@id("policy_permit_worker")
permit (
  principal,
  action,
  resource
)
when {
  principal.role == "worker" &&
  (
    (resource is OpsLens::Incident &&
     (action == OpsLens::Action::"createIncident" ||
      action == OpsLens::Action::"listIncidents" ||
      action == OpsLens::Action::"getIncident" ||
      action == OpsLens::Action::"addComment" ||
      action == OpsLens::Action::"answerClarification" ||
      action == OpsLens::Action::"getPresignedUploadUrl")) ||
    resource is OpsLens::Copilot ||
    (resource is OpsLens::Config && action == OpsLens::Action::"getReferenceData")
  )
};
