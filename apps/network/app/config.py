from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration. All values overridable via environment variables."""

    model_config = SettingsConfigDict(env_prefix="TRUSTMCP_", env_file=".env", extra="ignore")

    # Core
    environment: str = "development"
    database_url: str = "sqlite:///./.data/trustmcp.db"
    public_base_url: str = "http://localhost:8000"

    # Auth
    # Token presented by the web backend (Next.js) to manage vendors on behalf of users.
    service_token: str = "dev-service-token"
    # Prefix used when minting consumer access keys.
    key_prefix: str = "tmcp_live"

    # Freshness: window (days) before valid_until that an artifact is "expiring".
    expiring_window_days: int = 30
    # Default lifetime (days) for a granted access key.
    key_ttl_days: int = 90

    # Storage. If s3_bucket is empty, artifacts are stored on the local filesystem
    # under `storage_local_dir` and served via a network-signed redirect endpoint.
    s3_bucket: str = ""
    s3_region: str = "us-east-1"
    s3_endpoint_url: str = ""  # set for MinIO, e.g. http://localhost:9000
    s3_access_key_id: str = ""
    s3_secret_access_key: str = ""
    storage_local_dir: str = "./.data/artifacts"
    signed_url_ttl_seconds: int = 300

    # Domain verification challenge prefix.
    challenge_dns_prefix: str = "_trustmcp-challenge"

    # Custom-domain hosting: the CNAME target customers point their trust-center
    # subdomain at (e.g. trust.example.com -> cname.trustmcp.app). Used to build the
    # DNS instructions and to verify the customer pointed their domain at us.
    custom_domain_cname_target: str = "cname.trustmcp.app"

    # Custom-domain TLS issuance via the Render API. When a domain is verified we
    # register it on the Render web service that serves trust centers; Render then
    # issues the Let's Encrypt certificate, and a poller (app.provision_certs) flips
    # the stored status to "active" once HTTPS is live. No-ops when unset — the status
    # stays honest ("blocked"/"provisioning") but no certificate is requested.
    render_api_key: str = ""
    render_service_id: str = ""
    render_api_base: str = "https://api.render.com"

    @property
    def render_enabled(self) -> bool:
        return bool(self.render_api_key and self.render_service_id)


    # Domain Connect (the open "Plaid for DNS" standard) — our published template's
    # identifiers. The synchronous apply flow needs no per-provider credentials: the
    # customer approves the records in their own DNS provider's UI. For providers to
    # honor the apply, our template must be registered with them (see
    # apps/network/domain-connect/templates/).
    domain_connect_provider_id: str = "trustmcp.app"
    domain_connect_service_id: str = "trust-center"

    # Email (owner notifications + expiry nudges). No-ops if smtp_host is empty.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "TrustMCP <no-reply@trustmcp.org>"
    smtp_starttls: bool = True

    @property
    def use_smtp(self) -> bool:
        return bool(self.smtp_host)

    # CRM (for auto-release on verified customer relationship). Configure one.
    hubspot_token: str = ""
    salesforce_instance_url: str = ""
    salesforce_access_token: str = ""

    # Ed25519 signing key (base64 of 32-byte seed). Empty = ephemeral dev key.
    signing_private_key: str = ""

    # Public-endpoint rate limit (requests/min/IP). <= 0 disables.
    rate_limit_per_minute: int = 60

    # "Ask a question" AI widget. Grounds answers in the published profile via the
    # Anthropic API. No-ops with a friendly message when the API key is empty.
    anthropic_api_key: str = ""
    ask_model: str = "claude-opus-4-8"
    ask_max_tokens: int = 1024

    @property
    def ask_enabled(self) -> bool:
        return bool(self.anthropic_api_key)

    # Public web base (the trust-center builder/public app) - used to build links in
    # outbound emails (e.g. "view this update"). e.g. https://trustmcp.app
    web_base_url: str = ""

    # Docusign eSignature (JWT grant / impersonation). When configured, submitted DPAs
    # are turned into real signature envelopes sent to the signer. Leave unset to fall
    # back to capture-and-notify (the owner routes it to signature manually).
    docusign_account_id: str = ""
    docusign_integration_key: str = ""  # OAuth client id
    docusign_user_id: str = ""  # the impersonated user (API username GUID)
    docusign_private_key: str = ""  # RSA private key PEM (PKCS#1 or PKCS#8)
    docusign_auth_host: str = "account-d.docusign.com"  # prod: account.docusign.com
    docusign_base_uri: str = "https://demo.docusign.net/restapi"  # account base + /restapi
    docusign_dpa_template_id: str = ""  # network-default DPA template (vendor may override)
    docusign_role_name: str = "Signer"
    # Optional HMAC key configured in Docusign Connect to verify status webhooks.
    docusign_connect_hmac_key: str = ""

    @property
    def esign_enabled(self) -> bool:
        return bool(
            self.docusign_account_id
            and self.docusign_integration_key
            and self.docusign_user_id
            and self.docusign_private_key
        )

    # Google Drive OAuth. Configured ONCE by the network operator so trust-center
    # owners connect their folder by clicking through Google's consent screen and
    # never handle a client secret or a service-account key themselves.
    #
    # Leave unset and the Drive page falls back to asking the owner to paste their
    # own credentials, which is what a self-hoster without a Google Cloud project
    # has to do. Nothing breaks; the flow is just manual.
    google_client_id: str = ""
    google_client_secret: str = ""
    # Where Google sends the owner back. Must be registered verbatim as an
    # authorized redirect URI on the OAuth client, or Google refuses with
    # redirect_uri_mismatch. Defaults to the web app's callback route.
    google_oauth_redirect_url: str = ""
    # How long a consent round-trip may take before the signed state expires.
    google_oauth_state_ttl_seconds: int = 900

    @property
    def google_oauth_enabled(self) -> bool:
        return bool(self.google_client_id and self.google_client_secret)

    def drive_redirect_uri(self) -> str:
        """The registered callback URL, derived from the web base URL when unset."""
        if self.google_oauth_redirect_url:
            return self.google_oauth_redirect_url
        base = (self.web_base_url or self.public_base_url).rstrip("/")
        return f"{base}/api/integrations/drive/callback"

    # Observability
    sentry_dsn: str = ""

    @property
    def use_s3(self) -> bool:
        return bool(self.s3_bucket)

    def validate_for_production(self) -> list[str]:
        """Return fatal misconfigurations (empty = OK). Enforced at startup only when
        environment == 'production' (see main.lifespan). Catches silent security
        degradations that otherwise 'work' but weaken the deployment."""
        errors: list[str] = []
        if self.environment != "production":
            return errors
        if self.service_token == "dev-service-token":
            errors.append(
                "TRUSTMCP_SERVICE_TOKEN must be set to a strong secret in production"
            )
        if not self.signing_private_key:
            errors.append(
                "TRUSTMCP_SIGNING_PRIVATE_KEY must be set (stable Ed25519 seed) so "
                "signatures survive restarts/replicas"
            )
        if self.database_url.startswith("sqlite"):
            errors.append(
                "TRUSTMCP_DATABASE_URL must be a Postgres URL in production "
                "(sqlite is non-durable)"
            )
        return errors

    def production_warnings(self) -> list[str]:
        """Soft degradations worth logging at startup (do not block boot)."""
        warnings: list[str] = []
        if self.environment != "production":
            return warnings
        if not self.use_s3:
            warnings.append(
                "Using local disk storage - durable only with a mounted disk and a "
                "single instance. Configure S3/R2 for multi-instance deployments."
            )
        if not self.use_smtp:
            warnings.append(
                "SMTP is not configured - owner notifications and expiry nudges are disabled."
            )
        if self.rate_limit_per_minute > 0:
            warnings.append(
                "Rate limiting is in-memory (per-replica). Put a WAF/edge limiter in "
                "front for multi-replica deployments."
            )
        return warnings


@lru_cache
def get_settings() -> Settings:
    return Settings()
