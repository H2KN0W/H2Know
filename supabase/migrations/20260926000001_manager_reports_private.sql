-- Restrict report history to its owner while preserving admins' access.
alter policy "Authenticated users can view reports"
  on public.reports
  using (
    auth.role() = 'authenticated'
    and (is_admin() or generated_by = auth.uid())
  );

alter policy "manager_select_reports"
  on public.reports
  using (
    public.manager_can_access()
    and generated_by = auth.uid()
  );
