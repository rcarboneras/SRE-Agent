import express, { NextFunction, Request, Response } from "express";
import { DefaultAzureCredential } from "@azure/identity";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createRemoteJWKSet, jwtVerify } from "jose";
import * as z from "zod/v4";

const port = Number(process.env.PORT ?? "8080");
const inactiveUserDays = Number(process.env.INACTIVE_USER_DAYS ?? "90");
const optionalApiKey = process.env.SRE_AGENT_API_KEY;
const tenantId = process.env.TENANT_ID;
const bridgeAudience = process.env.BRIDGE_AUDIENCE;
const allowedClientIds = new Set(
  (process.env.ALLOWED_CLIENT_IDS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);

const credential = new DefaultAzureCredential();
const jwks = tenantId
  ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`))
  : undefined;

const graphQueryCatalog = [
  {
    scenario: "license consumption",
    method: "GET",
    path: "/subscribedSkus?$select=skuId,skuPartNumber,consumedUnits,prepaidUnits",
    description: "List tenant subscribed SKUs, purchased units, and consumed units."
  },
  {
    scenario: "licensed users",
    method: "GET",
    path: "/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses&$top=999",
    description: "List users and their assigned license SKU IDs."
  },
  {
    scenario: "inactive licensed users",
    method: "GET",
    path: "/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses,signInActivity&$top=999",
    description: "List users with license assignments and sign-in activity for inactivity analysis."
  },
  {
    scenario: "tenant domains",
    method: "GET",
    path: "/domains?$select=id,isDefault,isInitial,isVerified,supportedServices",
    description: "List tenant domains and verification state."
  },
  {
    scenario: "groups",
    method: "GET",
    path: "/groups?$select=id,displayName,mail,securityEnabled,mailEnabled,groupTypes,createdDateTime&$top=999",
    description: "List groups for access governance and hygiene analysis."
  },
  {
    scenario: "applications",
    method: "GET",
    path: "/applications?$select=id,appId,displayName,createdDateTime,signInAudience&$top=999",
    description: "List app registrations for application inventory and hygiene analysis."
  },
  {
    scenario: "service principals",
    method: "GET",
    path: "/servicePrincipals?$select=id,appId,displayName,servicePrincipalType,accountEnabled,appOwnerOrganizationId&$top=999",
    description: "List enterprise applications/service principals."
  },
  {
    scenario: "deleted users",
    method: "GET",
    path: "/directory/deletedItems/microsoft.graph.user?$select=id,displayName,userPrincipalName,deletedDateTime&$top=999",
    description: "List deleted users still recoverable in the directory recycle bin."
  },
  {
    scenario: "directory audit logs",
    method: "GET",
    path: "/auditLogs/directoryAudits?$top=50",
    description: "Read recent directory audit events for investigation context."
  },
  {
    scenario: "sign-in logs",
    method: "GET",
    path: "/auditLogs/signIns?$top=50",
    description: "Read recent sign-in events for investigation context."
  }
];

const graphEntityProperties: Record<string, string[]> = {
  user: [
    "id",
    "displayName",
    "userPrincipalName",
    "accountEnabled",
    "assignedLicenses",
    "assignedPlans",
    "createdDateTime",
    "department",
    "jobTitle",
    "mail",
    "signInActivity",
    "userType"
  ],
  subscribedSku: [
    "id",
    "skuId",
    "skuPartNumber",
    "appliesTo",
    "capabilityStatus",
    "consumedUnits",
    "prepaidUnits",
    "servicePlans"
  ],
  group: [
    "id",
    "displayName",
    "description",
    "mail",
    "mailEnabled",
    "securityEnabled",
    "groupTypes",
    "createdDateTime",
    "membershipRule",
    "visibility"
  ],
  application: [
    "id",
    "appId",
    "displayName",
    "createdDateTime",
    "signInAudience",
    "publisherDomain",
    "requiredResourceAccess",
    "web",
    "spa",
    "publicClient"
  ],
  servicePrincipal: [
    "id",
    "appId",
    "displayName",
    "accountEnabled",
    "appOwnerOrganizationId",
    "servicePrincipalType",
    "tags",
    "verifiedPublisher"
  ],
  domain: [
    "id",
    "isDefault",
    "isInitial",
    "isVerified",
    "supportedServices"
  ],
  signIn: [
    "id",
    "createdDateTime",
    "userDisplayName",
    "userPrincipalName",
    "appDisplayName",
    "ipAddress",
    "status",
    "conditionalAccessStatus"
  ],
  directoryAudit: [
    "id",
    "activityDateTime",
    "activityDisplayName",
    "category",
    "initiatedBy",
    "result",
    "targetResources"
  ]
};

function getBearerToken(req: Request): string | undefined {
  const authorization = req.header("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

async function authenticateMcpRequest(req: Request, res: Response, next: NextFunction) {
  if (optionalApiKey && req.header("x-api-key") === optionalApiKey) {
    next();
    return;
  }

  if (!tenantId || !bridgeAudience || !jwks) {
    res.status(500).json({ error: "JWT authentication is not configured." });
    return;
  }

  const token = getBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing bearer token." });
    return;
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      audience: bridgeAudience
    });

    const allowedIssuers = new Set([
      `https://login.microsoftonline.com/${tenantId}/v2.0`,
      `https://sts.windows.net/${tenantId}/`
    ]);

    if (!payload.iss || !allowedIssuers.has(payload.iss)) {
      res.status(401).json({ error: "Invalid token issuer." });
      return;
    }

    const callerClientId = String(payload.azp ?? payload.appid ?? payload.client_id ?? "").toLowerCase();
    if (allowedClientIds.size > 0 && !allowedClientIds.has(callerClientId)) {
      res.status(403).json({ error: "Caller application is not allowed." });
      return;
    }

    next();
  } catch (error) {
    console.error("JWT validation failed:", error);
    res.status(401).json({ error: "Invalid bearer token." });
  }
}

async function graphGet(pathOrUrl: string): Promise<any> {
  const token = await credential.getToken("https://graph.microsoft.com/.default");
  if (!token) {
    throw new Error("Unable to acquire Microsoft Graph token.");
  }

  const url = pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `https://graph.microsoft.com/v1.0${pathOrUrl}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.token}`,
      ConsistencyLevel: "eventual"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Graph request failed: ${response.status} ${response.statusText}. ${body}`);
  }

  return response.json();
}

function normalizeGraphPath(pathOrUrl: string): string {
  const trimmed = pathOrUrl.trim();
  const graphBase = "https://graph.microsoft.com/v1.0";

  if (trimmed.startsWith("https://graph.microsoft.com/v1.0/")) {
    return trimmed.substring(graphBase.length);
  }

  if (!trimmed.startsWith("/")) {
    throw new Error("Graph path must start with '/' or 'https://graph.microsoft.com/v1.0/'.");
  }

  return trimmed;
}

async function graphGetAny(pathOrUrl: string): Promise<any> {
  const token = await credential.getToken("https://graph.microsoft.com/.default");
  if (!token) {
    throw new Error("Unable to acquire Microsoft Graph token.");
  }

  const path = normalizeGraphPath(pathOrUrl);
  const url = `https://graph.microsoft.com/v1.0${path}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.token}`,
      ConsistencyLevel: "eventual"
    }
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Graph request failed: ${response.status} ${response.statusText}. ${text}`);
  }

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function graphPaged(path: string): Promise<any[]> {
  const results: any[] = [];
  let nextUrl: string | undefined = path;

  while (nextUrl) {
    const page = await graphGet(nextUrl);
    results.push(...(page.value ?? []));
    nextUrl = page["@odata.nextLink"];
  }

  return results;
}

function jsonResult(data: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, null, 2)
      }
    ]
  };
}

function createServer() {
  const server = new McpServer({
    name: "sre-license-mcp-bridge",
    version: "1.0.0"
  });

  server.registerTool(
    "microsoft_graph_suggest_queries",
    {
      description: "Suggest read-only Microsoft Graph v1.0 queries for Entra identity, directory, licensing, and hygiene scenarios.",
      inputSchema: {
        intent: z.string().describe("Natural language intent, for example 'find unassigned licenses' or 'list apps without owners'.")
      }
    },
    async ({ intent }) => {
      const terms = intent
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((term) => term.length > 2);

      const scored = graphQueryCatalog
        .map((entry) => {
          const haystack = `${entry.scenario} ${entry.description} ${entry.path}`.toLowerCase();
          const score = terms.reduce((total, term) => total + (haystack.includes(term) ? 1 : 0), 0);
          return { ...entry, score };
        })
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 8)
        .map(({ score, ...entry }) => entry);

      return jsonResult({
        intent,
        suggestions: scored.length > 0 ? scored : graphQueryCatalog.slice(0, 8)
      });
    }
  );

  server.registerTool(
    "microsoft_graph_get",
    {
      description: "Execute a read-only Microsoft Graph v1.0 GET request. Provide only the path after /v1.0, for example /users?$top=10. This bridge never executes write operations.",
      inputSchema: {
        path: z.string().describe("Microsoft Graph v1.0 path beginning with '/', or a full https://graph.microsoft.com/v1.0/... URL.")
      }
    },
    async ({ path }) => {
      const result = await graphGetAny(path);
      return jsonResult({
        method: "GET",
        path: normalizeGraphPath(path),
        result
      });
    }
  );

  server.registerTool(
    "microsoft_graph_list_properties",
    {
      description: "List common Microsoft Graph properties for supported Entra entities so the agent can construct precise read-only queries.",
      inputSchema: {
        entity: z
          .enum([
            "user",
            "subscribedSku",
            "group",
            "application",
            "servicePrincipal",
            "domain",
            "signIn",
            "directoryAudit"
          ])
          .describe("Graph entity type to inspect.")
      }
    },
    async ({ entity }) => jsonResult({ entity, properties: graphEntityProperties[entity] })
  );

  server.registerTool(
    "get_tenant_directory_summary",
    {
      description: "Return a read-only tenant summary: organization, domains, subscribed SKUs, and approximate user/group/application counts.",
    },
    async () => {
      const [organization, domains, subscribedSkus, userCount, groupCount, applicationCount, servicePrincipalCount] =
        await Promise.all([
          graphGetAny("/organization?$select=id,displayName,tenantType,verifiedDomains"),
          graphGetAny("/domains?$select=id,isDefault,isInitial,isVerified,supportedServices"),
          graphGetAny("/subscribedSkus?$select=skuId,skuPartNumber,consumedUnits,prepaidUnits"),
          graphGetAny("/users/$count"),
          graphGetAny("/groups/$count"),
          graphGetAny("/applications/$count"),
          graphGetAny("/servicePrincipals/$count")
        ]);

      return jsonResult({
        organization: organization.value?.[0] ?? null,
        domains: domains.value ?? [],
        subscribedSkus: subscribedSkus.value ?? [],
        counts: {
          users: Number(userCount),
          groups: Number(groupCount),
          applications: Number(applicationCount),
          servicePrincipals: Number(servicePrincipalCount)
        }
      });
    }
  );

  server.registerTool(
    "search_directory_users",
    {
      description: "Search directory users by display name or UPN and return license/sign-in relevant fields.",
      inputSchema: {
        query: z.string().describe("Search string for displayName or userPrincipalName."),
        top: z.number().int().min(1).max(50).default(20)
      }
    },
    async ({ query, top }) => {
      const escaped = query.replace(/'/g, "''");
      const path =
        `/users?$top=${top}&$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses,signInActivity` +
        `&$filter=startsWith(displayName,'${encodeURIComponent(escaped)}') or startsWith(userPrincipalName,'${encodeURIComponent(escaped)}')`;
      return jsonResult(await graphGetAny(path));
    }
  );

  server.registerTool(
    "get_user_license_details",
    {
      description: "Get license details for a single user by object ID or userPrincipalName.",
      inputSchema: {
        userIdOrUpn: z.string().describe("User object ID or userPrincipalName.")
      }
    },
    async ({ userIdOrUpn }) => {
      const encodedUser = encodeURIComponent(userIdOrUpn);
      const [user, licenseDetails] = await Promise.all([
        graphGetAny(`/users/${encodedUser}?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses,signInActivity`),
        graphGetAny(`/users/${encodedUser}/licenseDetails`)
      ]);

      return jsonResult({ user, licenseDetails: licenseDetails.value ?? [] });
    }
  );

  server.registerTool(
    "list_directory_groups",
    {
      description: "List directory groups for access governance and hygiene analysis.",
      inputSchema: {
        top: z.number().int().min(1).max(999).default(100)
      }
    },
    async ({ top }) =>
      jsonResult(
        await graphGetAny(
          `/groups?$top=${top}&$select=id,displayName,description,mail,mailEnabled,securityEnabled,groupTypes,createdDateTime,visibility`
        )
      )
  );

  server.registerTool(
    "list_applications_without_owners",
    {
      description: "Find app registrations that have no owners. This is useful for application risk and hygiene reviews.",
      inputSchema: {
        top: z.number().int().min(1).max(100).default(25)
      }
    },
    async ({ top }) => {
      const applications = await graphPaged(
        `/applications?$top=${top}&$select=id,appId,displayName,createdDateTime,signInAudience`
      );

      const results = [];
      for (const app of applications.slice(0, top)) {
        const owners = await graphGetAny(`/applications/${app.id}/owners?$select=id,displayName,userPrincipalName,appId&$top=1`);
        if ((owners.value ?? []).length === 0) {
          results.push(app);
        }
      }

      return jsonResult({
        scannedApplications: Math.min(applications.length, top),
        ownerlessApplications: results
      });
    }
  );

  server.registerTool(
    "list_service_principals",
    {
      description: "List enterprise applications/service principals for application inventory and hygiene analysis.",
      inputSchema: {
        top: z.number().int().min(1).max(999).default(100)
      }
    },
    async ({ top }) =>
      jsonResult(
        await graphGetAny(
          `/servicePrincipals?$top=${top}&$select=id,appId,displayName,servicePrincipalType,accountEnabled,appOwnerOrganizationId`
        )
      )
  );

  server.registerTool(
    "list_tenant_domains",
    {
      description: "List tenant domains and verification/default state.",
    },
    async () => jsonResult(await graphGetAny("/domains?$select=id,isDefault,isInitial,isVerified,supportedServices"))
  );

  server.registerTool(
    "list_recent_directory_audits",
    {
      description: "List recent directory audit events for provenance and investigation context.",
      inputSchema: {
        top: z.number().int().min(1).max(100).default(25)
      }
    },
    async ({ top }) =>
      jsonResult(
        await graphGetAny(
          `/auditLogs/directoryAudits?$top=${top}&$select=id,activityDateTime,activityDisplayName,category,result,initiatedBy,targetResources`
        )
      )
  );

  server.registerTool(
    "get_tenant_license_consumption",
    { description: "Get tenant license consumption by subscribed SKU." },
    async () => {
      const data = await graphGet("/subscribedSkus?$select=skuId,skuPartNumber,consumedUnits,prepaidUnits");
      return jsonResult(data.value);
    }
  );

  server.registerTool(
    "find_unassigned_licenses",
    { description: "Find unassigned license capacity by SKU." },
    async () => {
      const data = await graphGet("/subscribedSkus?$select=skuId,skuPartNumber,consumedUnits,prepaidUnits");
      const result = data.value.map((sku: any) => {
        const enabled = sku.prepaidUnits?.enabled ?? 0;
        const consumed = sku.consumedUnits ?? 0;

        return {
          skuId: sku.skuId,
          skuPartNumber: sku.skuPartNumber,
          enabled,
          consumed,
          unassigned: Math.max(enabled - consumed, 0),
          utilizationPercent: enabled === 0 ? 0 : Math.round((consumed / enabled) * 10000) / 100
        };
      });

      return jsonResult(result);
    }
  );

  server.registerTool(
    "get_assigned_licenses_per_user",
    { description: "List users that have assigned licenses." },
    async () => {
      const users = await graphPaged(
        "/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses&$top=999"
      );

      const licensedUsers = users
        .filter((user: any) => (user.assignedLicenses ?? []).length > 0)
        .map((user: any) => ({
          id: user.id,
          displayName: user.displayName,
          userPrincipalName: user.userPrincipalName,
          accountEnabled: user.accountEnabled,
          assignedLicenses: user.assignedLicenses
        }));

      return jsonResult(licensedUsers);
    }
  );

  server.registerTool(
    "detect_inactive_licensed_users",
    {
      description: "Find licensed users that have not signed in within the configured threshold.",
      inputSchema: {
        days: z.number().int().min(1).default(inactiveUserDays)
      }
    },
    async ({ days }) => {
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const users = await graphPaged(
        "/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses,signInActivity&$top=999"
      );

      const inactive = users
        .filter((user: any) => (user.assignedLicenses ?? []).length > 0)
        .filter((user: any) => {
          const lastSignIn = user.signInActivity?.lastSignInDateTime;
          return !lastSignIn || new Date(lastSignIn) < cutoff;
        })
        .map((user: any) => ({
          id: user.id,
          displayName: user.displayName,
          userPrincipalName: user.userPrincipalName,
          accountEnabled: user.accountEnabled,
          lastSignInDateTime: user.signInActivity?.lastSignInDateTime ?? null,
          assignedLicenseCount: user.assignedLicenses.length
        }));

      return jsonResult({
        thresholdDays: days,
        inactiveLicensedUserCount: inactive.length,
        users: inactive
      });
    }
  );

  server.registerTool(
    "generate_license_optimization_recommendations",
    {
      description: "Generate license optimization recommendations from SKU consumption and inactive licensed users.",
      inputSchema: {
        inactiveDays: z.number().int().min(1).default(inactiveUserDays)
      }
    },
    async ({ inactiveDays }) => {
      const skuData = await graphGet("/subscribedSkus?$select=skuId,skuPartNumber,consumedUnits,prepaidUnits");
      const cutoff = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);
      const users = await graphPaged(
        "/users?$select=id,displayName,userPrincipalName,accountEnabled,assignedLicenses,signInActivity&$top=999"
      );

      const inactiveLicensedUsers = users
        .filter((user: any) => (user.assignedLicenses ?? []).length > 0)
        .filter((user: any) => {
          const lastSignIn = user.signInActivity?.lastSignInDateTime;
          return !lastSignIn || new Date(lastSignIn) < cutoff;
        });

      const skus = skuData.value.map((sku: any) => {
        const enabled = sku.prepaidUnits?.enabled ?? 0;
        const consumed = sku.consumedUnits ?? 0;
        const unassigned = Math.max(enabled - consumed, 0);
        const utilizationPercent = enabled === 0 ? 0 : Math.round((consumed / enabled) * 10000) / 100;
        const recommendations: string[] = [];

        if (unassigned > 0) {
          recommendations.push(`Reallocate or avoid renewing ${unassigned} unassigned licenses.`);
        }

        if (enabled > 0 && utilizationPercent < 70) {
          recommendations.push("Review renewal quantity because utilization is below 70%.");
        }

        return {
          skuId: sku.skuId,
          skuPartNumber: sku.skuPartNumber,
          enabled,
          consumed,
          unassigned,
          utilizationPercent,
          recommendations
        };
      });

      return jsonResult({
        inactiveUserThresholdDays: inactiveDays,
        inactiveLicensedUserCount: inactiveLicensedUsers.length,
        recommendations: [
          "Review inactive licensed users before renewal or true-up.",
          "Validate with business owners before removing or downgrading licenses.",
          "Start with read-only reporting; require approval before remediation."
        ],
        skus
      });
    }
  );

  return server;
}

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/mcp", authenticateMcpRequest);

app.post("/mcp", async (req: Request, res: Response) => {
  const server = createServer();

  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);

    res.on("close", () => {
      transport.close();
      server.close();
    });
  } catch (error) {
    console.error(error);

    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error"
        },
        id: null
      });
    }
  }
});

app.get("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed"
    },
    id: null
  });
});

app.delete("/mcp", (_req, res) => {
  res.status(405).json({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message: "Method not allowed"
    },
    id: null
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`SRE License MCP bridge listening on port ${port}`);
});
