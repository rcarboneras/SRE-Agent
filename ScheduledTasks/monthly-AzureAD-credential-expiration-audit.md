# Monthly Azure AD Credential Expiration Audit Prompt

```text
Autonomous Scheduled Run
Scope: Tenant-wide Azure AD / Entra ID credential audit


Goal: Perform the monthly, read-only Microsoft Entra credential-expiration audit and publish BOTH a PDF and a self-contained actionable HTML report.

Scope:
- Microsoft Graph v1.0 applications and servicePrincipals.
- Include passwordCredentials and keyCredentials only when endDateTime is present.
- Exclude service principals where servicePrincipalType is ManagedIdentity.
- Use managed identity authentication only.
- Follow every @odata.nextLink until inventory is complete.

Classification:
- EXPIRED: endDateTime before now
- CRITICAL (<=7d): 0-7 days remaining
- EXPIRING SOON (<=30d): >7-30 days
- EXPIRING (<=90d): >30-90 days
- Valid: >90 days

Required artifacts:
- azure-ad-credential-expiration-audit-YYYY-MM-DD.pdf
- azure-ad-credential-expiration-audit-YYYY-MM-DD.html

HTML requirements:
- Embed refreshed inventory JSON; no live Graph calls on open.
- Render the credential inventory as an accessible table.
- Make every displayed table column sortable in both ascending and descending order, using an explicit sort control in each column header; correctly sort dates and numeric days-remaining values rather than lexicographic strings.
- Indicate the active sort column and direction in the UI, and preserve active filters when sorting.
- Credential-name search.
- Minimum/maximum days remaining.
- Status and object-type filters.
- Clear filters.
- Filtered CSV export.
- Direct Entra action links.

Validation:
- Require successful, nonzero Graph retrieval.
- Reconcile report counts to embedded rows.
- Browser-test name filtering, maximum-30-day filtering, action links, CSV download, and sorting for every displayed column in both directions; validate date and numeric sort correctness plus filter preservation.
- Validate PDF title and findings text.
- Publish both artifacts and return links.

Safety:
- READ-ONLY; no credential, application, service principal, permission, role, or Azure-resource changes.
- No email, notifications, or tickets.
- Do not publish a success-shaped report on Graph retrieval failure.
```
