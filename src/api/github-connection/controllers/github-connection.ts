import { factories } from '@strapi/strapi';

export default factories.createCoreController('api::github-connection.github-connection', ({ strapi }) => ({

  // ─── GitHub OAuth Sign-In / Sign-Up ──────────────────────────────────────────
  // Called from the frontend /auth/github/callback page.
  // Exchanges the GitHub code for an access token, finds or creates a Strapi
  // user, and returns a JWT identical to the email/password login response.
  async githubAuth(ctx) {
    try {
      const { code } = ctx.request.body as { code?: string };

      if (!code) {
        return ctx.badRequest('GitHub authorization code is required');
      }

      // 1. Exchange code → GitHub access token
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });

      const tokenData = (await tokenRes.json()) as any;

      if (tokenData.error || !tokenData.access_token) {
        strapi.log.warn('GitHub token exchange failed', tokenData);
        return ctx.badRequest(tokenData.error_description || 'Failed to exchange GitHub code');
      }

      const accessToken: string = tokenData.access_token;

      // 2. Fetch GitHub user profile
      const [profileRes, emailsRes] = await Promise.all([
        fetch('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
        }),
        fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' },
        }),
      ]);

      if (!profileRes.ok) {
        return ctx.badRequest('Failed to fetch GitHub profile');
      }

      const profile = (await profileRes.json()) as any;
      const emails  = emailsRes.ok ? ((await emailsRes.json()) as any[]) : [];

      // Pick the primary verified email; fall back to profile.email or a placeholder
      const primaryEmail: string =
        emails.find((e) => e.primary && e.verified)?.email ||
        profile.email ||
        `${profile.login}@users.noreply.github.com`;

      // 3. Find or create the Strapi user
      const pluginStore = strapi.store({ type: 'plugin', name: 'users-permissions' });
      const settings    = (await pluginStore.get({ key: 'advanced' })) as any;

      let user = await strapi.db.query('plugin::users-permissions.user').findOne({
        where: { email: primaryEmail },
      });

      if (!user) {
        // Create a new user — confirmed so they can log in immediately
        const authRole = await strapi.db.query('plugin::users-permissions.role').findOne({
          where: { type: 'authenticated' },
        });

        const username = profile.login || primaryEmail.split('@')[0];

        user = await strapi.db.query('plugin::users-permissions.user').create({
          data: {
            username,
            email: primaryEmail,
            // Random password — user will always log in via GitHub
            password: Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
            confirmed: true,
            blocked:   false,
            role:      authRole?.id,
            githubConnected: true,
            githubUsername:  profile.login,
            githubAccessToken: accessToken,
            plan: 'free',
            reviewCount: 0,
          },
        });
      } else {
        // Update GitHub connection details for existing user
        await strapi.db.query('plugin::users-permissions.user').update({
          where: { id: user.id },
          data: {
            githubConnected: true,
            githubUsername:  profile.login,
            githubAccessToken: accessToken,
          },
        });
      }

      // Ensure the api::github-connection.github-connection record is created/updated
      // so the /api/github/repos endpoint can find the access token for this user.
      const existingConnection = await strapi.db.query('api::github-connection.github-connection').findOne({
        where: { user: user.id },
      });

      const scope = tokenData.scope || 'read:user,user:email';

      if (existingConnection) {
        await strapi.db.query('api::github-connection.github-connection').update({
          where: { id: existingConnection.id },
          data: {
            accessToken,
            username: profile.login,
            avatarUrl: profile.avatar_url,
            scope,
            connectedAt: new Date(),
          },
        });
      } else {
        await strapi.db.query('api::github-connection.github-connection').create({
          data: {
            user: user.id,
            accessToken,
            username: profile.login,
            avatarUrl: profile.avatar_url,
            scope,
            connectedAt: new Date(),
          },
        });
      }

      if (user.blocked) {
        return ctx.unauthorized('Your account has been blocked');
      }

      // 4. Issue a Strapi JWT
      const jwtService  = strapi.plugin('users-permissions').service('jwt');
      const jwt: string = jwtService.issue({ id: user.id });

      // 5. Return same shape as /api/auth/local
      return ctx.send({
        jwt,
        user: {
          id:               user.id,
          username:         user.username,
          email:            user.email,
          githubUsername:   profile.login,
          githubConnected:  true,
          plan:             user.plan  || 'free',
          reviewCount:      user.reviewCount || 0,
        },
      });
    } catch (error) {
      strapi.log.error('GitHub auth error', error);
      return ctx.internalServerError('GitHub authentication failed');
    }
  },

  // ─── Connect GitHub to an existing account ───────────────────────────────────
  async exchangeCode(ctx) {
    try {
      const { code } = ctx.request.body;
      const user = ctx.state.user;

      if (!user) {
        return ctx.unauthorized('You must be logged in to connect GitHub');
      }

      if (!code) {
        return ctx.badRequest('GitHub code is required');
      }

      const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });

      const tokenData = (await tokenResponse.json()) as any;

      if (tokenData.error) {
        return ctx.badRequest(tokenData.error_description || 'Failed to exchange code');
      }

      const accessToken = tokenData.access_token;
      const scope = tokenData.scope;

      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      const userData = (await userResponse.json()) as any;

      if (!userResponse.ok) {
        return ctx.badRequest(userData.message || 'Failed to fetch GitHub user');
      }

      const existingConnection = await strapi.db.query('api::github-connection.github-connection').findOne({
        where: { user: user.id },
      });

      if (existingConnection) {
        await strapi.db.query('api::github-connection.github-connection').update({
          where: { id: existingConnection.id },
          data: {
            accessToken,
            username: userData.login,
            avatarUrl: userData.avatar_url,
            scope,
            connectedAt: new Date(),
          },
        });
      } else {
        await strapi.db.query('api::github-connection.github-connection').create({
          data: {
            user: user.id,
            accessToken,
            username: userData.login,
            avatarUrl: userData.avatar_url,
            scope,
            connectedAt: new Date(),
          },
        });
      }

      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: {
          githubAccessToken: accessToken,
          githubUsername: userData.login,
          githubConnected: true,
        },
      });

      return {
        success: true,
        username: userData.login,
        avatarUrl: userData.avatar_url,
      };
    } catch (error) {
      strapi.log.error('GitHub exchange code error', error);
      return ctx.badRequest('Internal server error');
    }
  },

  async disconnect(ctx) {
    try {
      const user = ctx.state.user;

      if (!user) {
        return ctx.unauthorized('You must be logged in to disconnect GitHub');
      }

      await strapi.db.query('api::github-connection.github-connection').delete({
        where: { user: user.id },
      });

      await strapi.db.query('plugin::users-permissions.user').update({
        where: { id: user.id },
        data: {
          githubAccessToken: null,
          githubUsername: null,
          githubConnected: false,
        },
      });

      return { success: true };
    } catch (error) {
      strapi.log.error('GitHub disconnect error', error);
      return ctx.badRequest('Internal server error');
    }
  },
}));
