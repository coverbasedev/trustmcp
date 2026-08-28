"use client";

import { useState } from "react";
import { Select } from "@/components/select";

// Dynamic CRM connection fields: only the inputs relevant to the current choices
// are shown. Provider drives whether the Salesforce instance URL appears;
// connection method switches between an API token and an MCP server; and the MCP
// auth method switches between a static bearer token and OAuth client-credentials.
// Hidden fields aren't submitted, so switching away clears the non-secret ones on
// save (secrets are only updated when re-typed).
export function CrmConnectionFields(props: {
  provider: string;
  connection: string;
  crmConfigured: boolean;
  instanceUrl: string;
  mcpUrl: string;
  mcpConfigured: boolean;
  mcpAuth: string;
  mcpClientId: string;
  mcpTokenUrl: string;
  mcpClientSecretSet: boolean;
}) {
  const [provider, setProvider] = useState(props.provider || "");
  const [connection, setConnection] = useState(props.connection || "api");
  const [mcpAuth, setMcpAuth] = useState(props.mcpAuth || "bearer");

  return (
    <div className="space-y-3">
      <div>
        <label className="label" htmlFor="crm_provider">Provider</label>
        <Select
          id="crm_provider"
          name="crm_provider"
          ariaLabel="Provider"
          value={provider}
          onChange={setProvider}
          options={[
            { value: "", label: "None" },
            { value: "hubspot", label: "HubSpot" },
            { value: "salesforce", label: "Salesforce" },
          ]}
        />
      </div>

      {provider !== "" && (
        <>
          <div>
            <label className="label" htmlFor="crm_connection">Connection method</label>
            <Select
              id="crm_connection"
              name="crm_connection"
              ariaLabel="Connection method"
              value={connection}
              onChange={setConnection}
              options={[
                { value: "api", label: "API token" },
                { value: "mcp", label: "MCP server" },
              ]}
            />
          </div>

          {connection === "api" && (
            <div className="space-y-3 rounded-md border border-slate-200 p-3">
              <div>
                <label className="label" htmlFor="crm_token">API token</label>
                <input
                  id="crm_token"
                  name="crm_token"
                  type="password"
                  className="input"
                  placeholder={props.crmConfigured ? "•••••• (unchanged)" : "paste token"}
                />
                <p className="mt-1 text-xs text-slate-400">
                  {provider === "hubspot"
                    ? "HubSpot private-app token."
                    : "Salesforce OAuth access token."}{" "}
                  Leave blank to keep the existing one.
                </p>
              </div>
              {provider === "salesforce" && (
                <div>
                  <label className="label" htmlFor="crm_instance_url">Salesforce instance URL</label>
                  <input
                    id="crm_instance_url"
                    name="crm_instance_url"
                    className="input"
                    defaultValue={props.instanceUrl}
                    placeholder="https://yourorg.my.salesforce.com"
                  />
                </div>
              )}
            </div>
          )}

          {connection === "mcp" && (
            <div className="space-y-3 rounded-md border border-slate-200 p-3">
              <div>
                <label className="label" htmlFor="crm_mcp_url">MCP server URL</label>
                <input
                  id="crm_mcp_url"
                  name="crm_mcp_url"
                  className="input"
                  defaultValue={props.mcpUrl}
                  placeholder="https://your-crm.example.com/mcp"
                />
                <p className="mt-1 text-xs text-slate-400">
                  A Streamable-HTTP MCP endpoint we query for a company/account by domain.
                </p>
              </div>
              <div>
                <label className="label" htmlFor="crm_mcp_auth">MCP authentication</label>
                <Select
                  id="crm_mcp_auth"
                  name="crm_mcp_auth"
                  ariaLabel="MCP authentication"
                  value={mcpAuth}
                  onChange={setMcpAuth}
                  options={[
                    { value: "oauth", label: "OAuth (client credentials)" },
                    { value: "bearer", label: "Bearer token" },
                  ]}
                />
              </div>

              {mcpAuth === "bearer" && (
                <div>
                  <label className="label" htmlFor="crm_mcp_token">Bearer token</label>
                  <input
                    id="crm_mcp_token"
                    name="crm_mcp_token"
                    type="password"
                    className="input"
                    placeholder={props.mcpConfigured ? "•••••• (unchanged)" : "paste token"}
                  />
                  <p className="mt-1 text-xs text-slate-400">
                    Sent as <code>Authorization: Bearer …</code>. Leave blank to keep the existing one.
                  </p>
                </div>
              )}

              {mcpAuth === "oauth" && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <label className="label" htmlFor="crm_mcp_token_url">Token URL</label>
                    <input
                      id="crm_mcp_token_url"
                      name="crm_mcp_token_url"
                      className="input"
                      defaultValue={props.mcpTokenUrl}
                      placeholder="https://auth.example.com/oauth/token"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="crm_mcp_client_id">Client ID</label>
                    <input
                      id="crm_mcp_client_id"
                      name="crm_mcp_client_id"
                      className="input"
                      defaultValue={props.mcpClientId}
                      placeholder="client id"
                    />
                  </div>
                  <div>
                    <label className="label" htmlFor="crm_mcp_client_secret">Client secret</label>
                    <input
                      id="crm_mcp_client_secret"
                      name="crm_mcp_client_secret"
                      type="password"
                      className="input"
                      placeholder={props.mcpClientSecretSet ? "•••••• (unchanged)" : "client secret"}
                    />
                  </div>
                  <p className="text-xs text-slate-400 sm:col-span-2">
                    We exchange these for an access token via the client-credentials grant. Leave the
                    secret blank to keep the existing one.
                  </p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
