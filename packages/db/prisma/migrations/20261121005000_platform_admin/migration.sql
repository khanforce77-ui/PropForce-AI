-- Platform administrators get a read-only, cross-agency view for the platform dashboard.
-- Two conditions must both hold, checked by the database itself:
--   1. the transaction opted in with app.platform_admin = 'on' (only withPlatformAdmin does this), and
--   2. app.user_id is a user whose is_platform_admin flag is true.
-- Only SELECT policies are added: platform admins cannot change agency data through this path.
CREATE FUNCTION app_is_platform_admin() RETURNS boolean
  LANGUAGE sql STABLE
  AS $$
    SELECT coalesce(current_setting('app.platform_admin', true), '') = 'on'
       AND EXISTS (
         SELECT 1 FROM "user" u WHERE u.id = app_current_user() AND u.is_platform_admin
       )
  $$;
GRANT EXECUTE ON FUNCTION app_is_platform_admin() TO propforce_app;

CREATE POLICY platform_admin_read ON "agency"     FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "membership" FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "property"   FOR SELECT USING (app_is_platform_admin());
