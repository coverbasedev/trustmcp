import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import Credentials from "next-auth/providers/credentials";
import { db } from "@/lib/db";

/**
 * The dev credentials provider signs anyone in with just an email and no
 * password - strictly a local-development convenience. Enabled only when
 * AUTH_DEV_LOGIN=1, and never in a production build unless a deploy explicitly
 * opts in with AUTH_DEV_LOGIN_ALLOW_PROD=1 (used by the CI e2e job, which runs a
 * production standalone server). So a real deploy can't expose the no-password
 * bypass just by leaving AUTH_DEV_LOGIN set.
 */
export function devLoginEnabled(): boolean {
  if (process.env.AUTH_DEV_LOGIN !== "1") return false;
  if (process.env.NODE_ENV === "production" && process.env.AUTH_DEV_LOGIN_ALLOW_PROD !== "1") {
    return false;
  }
  return true;
}

function buildProviders() {
  const providers: NextAuthConfig["providers"] = [];
  // allowDangerousEmailAccountLinking: link a new OAuth login to an existing
  // user with the same (provider-verified) email instead of failing with
  // OAuthAccountNotLinked. GitHub and Google both verify email ownership, so a
  // user can sign in with whichever provider they choose and land on one account.
  if (process.env.AUTH_GITHUB_ID && process.env.AUTH_GITHUB_SECRET) {
    providers.push(
      GitHub({
        clientId: process.env.AUTH_GITHUB_ID,
        clientSecret: process.env.AUTH_GITHUB_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
    providers.push(
      Google({
        clientId: process.env.AUTH_GOOGLE_ID,
        clientSecret: process.env.AUTH_GOOGLE_SECRET,
        allowDangerousEmailAccountLinking: true,
      }),
    );
  }
  // Enterprise SSO via a generic OIDC provider (Okta / Entra ID / Auth0 / Google
  // Workspace, etc.). Configure the issuer + client credentials to enable.
  if (process.env.SSO_ISSUER && process.env.SSO_CLIENT_ID && process.env.SSO_CLIENT_SECRET) {
    providers.push({
      id: "sso",
      name: process.env.SSO_NAME ?? "Enterprise SSO",
      type: "oidc",
      issuer: process.env.SSO_ISSUER,
      clientId: process.env.SSO_CLIENT_ID,
      clientSecret: process.env.SSO_CLIENT_SECRET,
      allowDangerousEmailAccountLinking: true,
    });
  }
  // Email sign-in link (verifies email ownership) when SMTP is configured.
  if (process.env.EMAIL_SERVER && process.env.EMAIL_FROM) {
    providers.push(
      Nodemailer({
        server: process.env.EMAIL_SERVER,
        from: process.env.EMAIL_FROM,
      }),
    );
  }
  // Dev credentials login (local only): sign in with any email, no password.
  if (devLoginEnabled()) {
    providers.push(
      Credentials({
        id: "dev",
        name: "Dev email",
        credentials: { email: { label: "Email", type: "email" } },
        async authorize(creds) {
          const email = String(creds?.email ?? "").trim().toLowerCase();
          if (!email || !email.includes("@")) return null;
          const user = await db.user.upsert({
            where: { email },
            update: {},
            create: { email, name: email.split("@")[0] },
          });
          return { id: user.id, email: user.email, name: user.name };
        },
      }),
    );
  }
  return providers;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: "jwt" },
  // Required behind a load balancer / reverse proxy in production (e.g. Render).
  trustHost: true,
  // Route the auth UI to our own pages: a styled sign-in, a "check your email"
  // confirmation after requesting a sign-in link, and errors back onto /login
  // (read from ?error= and shown as a banner).
  pages: { signIn: "/login", verifyRequest: "/verify-request", error: "/login" },
  providers: buildProviders(),
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        let uid = user.id as string;
        // Account linking/merge: when the user kicked off a "Connect" from
        // settings, connectProvider set a `tm_link_into` cookie naming the
        // account to land on. If this OAuth resolved to a *different* account,
        // merge that account's workspaces/trust centers into the target and
        // keep the session on the target. Best-effort; never blocks sign-in.
        try {
          const { cookies } = await import("next/headers");
          const store = await cookies();
          const linkInto = store.get("tm_link_into")?.value;
          if (linkInto) {
            if (linkInto !== uid) {
              const { mergeAccounts } = await import("@/lib/account");
              if (await mergeAccounts(uid, linkInto)) uid = linkInto;
            }
            store.delete("tm_link_into");
          }
        } catch {
          // ignore — fall back to a normal sign-in as the resolved account
        }
        token.uid = uid;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid && session.user) session.user.id = token.uid as string;
      return session;
    },
  },
  events: {
    // On every sign-in, add the user to any workspace that has whitelisted their
    // email domain (idempotent). Failures here must never block sign-in.
    async signIn({ user }) {
      try {
        if (user?.id) {
          const { autoJoinByDomain } = await import("@/lib/team");
          await autoJoinByDomain(user.id, user.email);
        }
      } catch {
        // best-effort; domain auto-join should not break authentication
      }
    },
  },
});
