-- The public portal may read an off-plan project's name, developer and handover date, but only
-- for projects that have at least one publicly visible listing (the property subquery is itself
-- filtered by property's public_portal_read policy).
CREATE POLICY public_portal_read ON "project" FOR SELECT
  USING (
    app_is_public_portal()
    AND EXISTS (
      SELECT 1 FROM "property" p
      WHERE p.project_id = project.id AND p.tenant_id = project.tenant_id
    )
  );
