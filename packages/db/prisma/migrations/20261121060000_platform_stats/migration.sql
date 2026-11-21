-- Platform admins (opt-in context + is_platform_admin flag, checked by app_is_platform_admin())
-- may read leads and portal enquiries across agencies, for the platform dashboard's counts and
-- trends. Read-only: no write policies are added.
CREATE POLICY platform_admin_read ON "lead"           FOR SELECT USING (app_is_platform_admin());
CREATE POLICY platform_admin_read ON "portal_enquiry" FOR SELECT USING (app_is_platform_admin());
